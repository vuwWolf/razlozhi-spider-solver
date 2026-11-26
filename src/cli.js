#!/usr/bin/env node
import readline from 'node:readline';
import { SpiderGame } from './browser.js';
import { createState, fromSnapshot, isWin, applyMove, describeMove } from './model.js';
import { solveWithRestarts } from './solver.js';
import { writeMoveLog } from './report.js';
import { plannedGames } from './modes.js';

function parseArgs(argv) {
  const opts = {
    deck: null,
    daily: false,
    login: false,
    headless: false,
    games: 10,
    attempts: 8,
    maxNodes: 1500,
    timeLimitMs: 20000,
    dryRun: false,
    logFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headless') opts.headless = true;
    else if (a === '--daily') opts.daily = true;
    else if (a === '--login') opts.login = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if ((a === '--log-file' || a === '--out') && argv[i + 1]) opts.logFile = argv[++i];
    else if (a === '--deck' && argv[i + 1]) opts.deck = argv[++i];
    else if (a === '--games' && argv[i + 1]) opts.games = Number(argv[++i]);
    else if (a === '--attempts' && argv[i + 1]) opts.attempts = Number(argv[++i]);
    else if (a === '--max-nodes' && argv[i + 1]) opts.maxNodes = Number(argv[++i]);
    else if (a === '--timeout' && argv[i + 1]) opts.timeLimitMs = Number(argv[++i]);
  }
  return opts;
}

function log(...args) {
  console.log('[spider]', ...args);
}

/** Ждём, пока пользователь зайдёт на сайт (Enter или появление user в конфиге). */
function waitForLogin(game) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let done = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      rl.close();
      resolve(how);
    };
    rl.question('[spider] Войдите на сайт в открывшемся окне и нажмите Enter здесь...\n',
      () => finish('enter'));
    const timer = setInterval(async () => {
      try {
        if ((await game.loginStatus()).loggedIn) finish('detected');
      } catch {
        // страница может в этот момент перезагружаться после OAuth
      }
    }, 1500);
  });
}

/** Одна попытка: прочитать состояние, найти решение и выполнить его. */
async function playGame(game, opts, deckCode) {
  const snapshot = await game.readState();
  log('состояние:', {
    hidden: snapshot.cols.reduce((n, c) => n + c.down.length, 0),
    stock: snapshot.stock.length,
    foundations: snapshot.foundations,
  });

  const state = deckCode ? createState(deckCode) : fromSnapshot(snapshot);
  if (isWin(state)) {
    log('игра уже выиграна');
    return { ok: true, alreadyWon: true };
  }

  log('поиск решения...');
  const result = solveWithRestarts(state, {
    restarts: opts.attempts,
    maxSteps: opts.maxNodes,
    timeLimitMs: opts.timeLimitMs,
  });
  if (!result) {
    log('решение не найдено на этой колоде');
    return { ok: false };
  }

  log(`решение найдено: ${result.moves.length} ходов, попытка ${result.attempt}`);

  if (opts.logFile) {
    const saved = await writeMoveLog(opts.logFile, {
      moves: result.moves,
      state,
      deckCode,
      attempt: result.attempt,
    });
    log(`ходы записаны в файл: ${saved.path} (${saved.moves} ходов)`);
  }

  if (opts.dryRun) {
    let s = state;
    for (const m of result.moves) {
      log(describeMove(m, s));
      s = applyMove(s, m);
    }
    return { ok: true, dryRun: true };
  }

  let current = state;
  let applied = 0;
  for (const move of result.moves) {
    const description = describeMove(move, current);
    const ok = await game.executeMove(move);
    if (!ok) {
      log(`не удалось выполнить ход: ${description}`);
      return { ok: false, failedMove: description };
    }
    current = applyMove(current, move);
    applied++;
    if (applied % 10 === 0) log(`выполнено ${applied}/${result.moves.length}`);
  }

  const final = await game.readState();
  log('итог:', {
    winner: final.winner,
    foundations: final.foundations,
    hidden: final.cols.reduce((n, c) => n + c.down.length, 0),
  });
  if (!final.winner) {
    log('ходили до конца, но сайт не признал победу');
    return { ok: false, final };
  }
  return { ok: true, final };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Для логина окно должно быть видимым, иначе пользователю некуда вводить данные.
  const game = await SpiderGame.launch({ headless: opts.login ? false : opts.headless });

  try {
    log('открыта страница игры');

    if (opts.login) {
      log('постоянный профиль:', game.profile);
      const how = await waitForLogin(game);
      // После логина вкладка может уйти на страницу OAuth — возвращаемся на игру.
      await game.open();
      const status = await game.loginStatus();
      if (status.loggedIn) {
        log('авторизация сохранена в профиле (', how, '):',
          status.user.displayName || status.user.username || status.user.number || status.user);
      } else {
        log('авторизация не обнаружена — проверьте, вошли ли вы в окне браузера');
      }
      return;
    }

    if (opts.daily) {
      const daily = await game.startDailyGame();
      log('ежедневная колода:', daily ? `${daily.date} (${daily.deck.slice(0, 12)}…)` : 'не найдена в конфиге');
    } else if (opts.deck) {
      await game.startWithDeck(opts.deck);
      log('игра начата с заданной колодой');
    } else {
      await game.startNewGame();
      log('новая игра начата');
    }

    const totalGames = plannedGames(opts);
    for (let gameNo = 1; gameNo <= totalGames; gameNo++) {
      if (gameNo > 1) {
        await game.startNewGame();
        log(`новая колода: попытка ${gameNo}/${totalGames}`);
      }
      const code = await game.deckCode();
      log('колода:', code);

      const outcome = await playGame(game, opts, opts.deck || code);
      if (outcome.ok) return;
      if (opts.deck) break; // фиксированную колоду переигрывать бессмысленно
    }

    log('победа не достигнута за отведённое число колод');
    process.exitCode = 1;
  } finally {
    await game.close();
  }
}

main().catch((err) => {
  console.error('[spider] ошибка:', err);
  process.exitCode = 1;
});
