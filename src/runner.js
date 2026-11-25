/**
 * Оркестрация игровых запусков для веб-интерфейса.
 *
 * Почти та же логика, что в CLI, но состояние и логи выставляются наружу
 * через EventEmitter — сервер транслирует их в браузер по SSE.
 */
import { EventEmitter } from 'node:events';
import {
  createState, fromSnapshot, isWin, applyMove, describeMove,
} from './model.js';
import { solveInWorker, stopSolver } from './solver-client.js';

const INITIAL_STATUS = {
  phase: 'idle',
  mode: null,
  deck: null,
  gameNo: 0,
  totalGames: 0,
  solutionMoves: 0,
  executed: 0,
  total: 0,
  foundations: 0,
  hidden: 0,
  winner: false,
  user: null,
  message: 'Готово к запуску',
};

function userLabel(user) {
  return user?.displayName || user?.username || user?.number || JSON.stringify(user);
}

export class Runner extends EventEmitter {
  /** createGame позволяет десктопу подставить встроенный драйвер вместо Playwright. */
  constructor({ createGame = null } = {}) {
    super();
    this.createGame = createGame;
    this.game = null;
    this.running = false;
    this.stopRequested = false;
    this.loginWaiters = [];
    this.status = { ...INITIAL_STATUS };
  }

  log(...args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    this.emit('log', line);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  getStatus() {
    return { ...this.status, running: this.running };
  }

  async openGame(headless = true) {
    await this.closeGame();
    if (this.createGame) {
      this.game = await this.createGame({ headless });
      return;
    }
    // Playwright нужен только CLI/вебу; десктоп подставляет свой драйвер и
    // вообще не загружает этот модуль.
    const { SpiderGame } = await import('./browser.js');
    this.game = await SpiderGame.launch({ headless });
  }

  async closeGame() {
    if (!this.game) return;
    const game = this.game;
    this.game = null;
    await game.close();
  }

  /** Остановить текущий запуск (эффективно между ходами). */
  stop() {
    this.stopRequested = true;
    stopSolver();
    const waiters = this.loginWaiters;
    this.loginWaiters = [];
    for (const resolve of waiters) resolve('stop');
    if (!this.running) this.closeGame().catch(() => {});
    if (this.status.phase !== 'idle') {
      this.setStatus({ message: 'Остановка...' });
    }
  }

  /** Подтвердить вход вручную (кнопка «Я вошёл» в интерфейсе). */
  confirmLogin(how = 'button') {
    const waiters = this.loginWaiters;
    this.loginWaiters = [];
    for (const resolve of waiters) resolve(how);
  }

  /** Полный прогон: обычная игра, колода дня или заданная колода. */
  async start(opts = {}) {
    if (this.running) {
      this.log('уже запущено — сначала остановите текущий запуск');
      return false;
    }

    this.running = true;
    this.stopRequested = false;
    const mode = ['normal', 'daily', 'deck'].includes(opts.mode) ? opts.mode : 'normal';
    const totalGames = mode === 'deck'
      ? 1
      : Math.max(1, Number(opts.games) || 1);

    this.setStatus({
      phase: 'starting',
      mode,
      deck: null,
      gameNo: 0,
      totalGames,
      solutionMoves: 0,
      executed: 0,
      total: 0,
      winner: false,
      user: null,
      message: 'Открываем браузер...',
    });

    try {
      await this.openGame(opts.headless !== false);
      this.log('открыта страница игры');

      for (let gameNo = 1; gameNo <= totalGames; gameNo++) {
        if (this.stopRequested) break;
        this.setStatus({ gameNo, phase: 'starting', message: 'Начинаем игру...' });

        if (mode === 'daily') {
          const daily = await this.game.startDailyGame();
          this.log('ежедневная колода:', daily
            ? `${daily.date} (${daily.deck.slice(0, 12)}…)`
            : 'не найдена в конфиге');
        } else if (mode === 'deck') {
          await this.game.startWithDeck(opts.deck);
          this.log('игра начата с заданной колодой');
        } else {
          await this.game.startNewGame();
          this.log('новая игра начата');
        }
        if (gameNo > 1) this.log(`новая колода: попытка ${gameNo}/${totalGames}`);

        const code = await this.game.deckCode();
        this.setStatus({ deck: code, message: 'Колода загружена' });
        this.log('колода:', code);

        const outcome = await this.playOnce({
          deck: mode === 'deck' ? opts.deck : code,
          opts,
        });
        if (outcome.ok) return true;
        if (this.stopRequested) {
          this.setStatus({ phase: 'stopped', message: 'Остановлено' });
          return false;
        }
        if (mode === 'deck') break;
      }

      this.setStatus({ phase: 'failed', message: 'Победа не достигнута' });
      this.log('победа не достигнута за отведённое число колод');
      return false;
    } catch (err) {
      this.log('ошибка:', err?.message || String(err));
      this.setStatus({ phase: 'error', message: err?.message || String(err) });
      return false;
    } finally {
      this.running = false;
      await this.closeGame();
    }
  }

  async playOnce({ deck, opts }) {
    const snapshot = await this.game.readState();
    this.setStatus({
      hidden: snapshot.cols.reduce((n, c) => n + c.down.length, 0),
    });
    this.log('состояние:', {
      hidden: snapshot.cols.reduce((n, c) => n + c.down.length, 0),
      stock: snapshot.stock.length,
      foundations: snapshot.foundations,
    });

    const state = deck ? createState(deck) : fromSnapshot(snapshot);
    if (isWin(state)) {
      this.setStatus({ phase: 'won', winner: true, message: 'Игра уже выиграна' });
      this.log('игра уже выиграна');
      return { ok: true };
    }

    this.setStatus({ phase: 'solving', message: 'Ищем решение...' });
    this.log('поиск решения...');
    const result = await solveInWorker(state, {
      restarts: Number(opts.attempts) || 8,
      maxSteps: Number(opts.maxNodes) || 1500,
      timeLimitMs: Number(opts.timeout) || 20000,
    }, (progress) => {
      if (progress.kind === 'attempt') {
        this.setStatus({
          message: `Ищем решение... попытка ${progress.attempt}/${progress.attempts}`,
        });
      } else if (progress.kind === 'search') {
        this.setStatus({
          message: `Ищем решение... попытка ${progress.attempt}, узлов ${progress.nodes}`,
        });
      }
    });

    if (this.stopRequested) {
      this.setStatus({ phase: 'stopped', message: 'Остановлено' });
      this.log('остановлено во время поиска');
      return { ok: false, stopped: true };
    }
    if (!result) {
      this.setStatus({ phase: 'failed', message: 'Решение не найдено на этой колоде' });
      this.log('решение не найдено на этой колоде');
      return { ok: false };
    }

    this.log(`решение найдено: ${result.moves.length} ходов, попытка ${result.attempt}`);
    this.setStatus({
      phase: 'playing',
      solutionMoves: result.moves.length,
      total: result.moves.length,
      executed: 0,
      message: 'Выполняем ходы...',
    });

    let current = state;
    let executed = 0;
    for (const move of result.moves) {
      if (this.stopRequested) {
        this.setStatus({ phase: 'stopped', message: 'Остановлено' });
        this.log('остановлено');
        return { ok: false, stopped: true };
      }
      const description = describeMove(move, current);
      const ok = await this.game.executeMove(move);
      if (!ok) {
        this.setStatus({ phase: 'error', message: `Не удалось выполнить ход: ${description}` });
        this.log('не удалось выполнить ход:', description);
        return { ok: false };
      }
      current = applyMove(current, move);
      executed++;
      this.setStatus({
        executed,
        message: `Ход ${executed}/${result.moves.length}: ${description}`,
      });
      if (executed % 10 === 0) this.log(`выполнено ${executed}/${result.moves.length}`);
    }

    const final = await this.game.readState();
    const hidden = final.cols.reduce((n, c) => n + c.down.length, 0);
    this.log('итог:', {
      winner: final.winner,
      foundations: final.foundations,
      hidden,
    });
    this.setStatus({
      phase: final.winner ? 'won' : 'failed',
      winner: Boolean(final.winner),
      foundations: final.foundations,
      hidden,
      executed,
      message: final.winner ? 'Победа!' : 'Сайт не признал победу',
    });
    return { ok: Boolean(final.winner) };
  }

  /** Авторизация: видимое окно, ждём входа, сохраняем профиль. */
  async login() {
    if (this.running) {
      this.log('уже запущено — сначала остановите текущий запуск');
      return false;
    }

    this.running = true;
    this.stopRequested = false;
    this.setStatus({
      phase: 'login',
      mode: 'login',
      user: null,
      message: 'Войдите на сайт в открывшемся окне',
    });

    try {
      await this.openGame(false); // логин требует видимого окна
      this.log('постоянный профиль:', this.game.profile);
      this.log('в открывшемся окне нажмите «Войти на сайт»');

      const poll = setInterval(async () => {
        try {
          if ((await this.game.loginStatus()).loggedIn) this.confirmLogin('detected');
        } catch {
          // страница может перезагружаться после OAuth
        }
      }, 1500);

      const how = await new Promise((resolve) => this.loginWaiters.push(resolve));
      clearInterval(poll);

      if (this.stopRequested) {
        this.setStatus({ phase: 'stopped', message: 'Остановлено' });
        return false;
      }

      await this.game.open();
      const status = await this.game.loginStatus();
      if (status.loggedIn) {
        this.log('авторизация сохранена в профиле (', how, '):', userLabel(status.user));
        this.setStatus({
          phase: 'logged-in',
          user: status.user,
          message: 'Авторизация сохранена',
        });
        return true;
      }

      this.log('авторизация не обнаружена');
      this.setStatus({ phase: 'failed', message: 'Авторизация не обнаружена' });
      return false;
    } catch (err) {
      this.log('ошибка:', err?.message || String(err));
      this.setStatus({ phase: 'error', message: err?.message || String(err) });
      return false;
    } finally {
      this.running = false;
      await this.closeGame();
    }
  }
}
