/**
 * Управление игрой на razlozhi.ru через внутренний API сайта.
 *
 * Подход: внедряем перехватчик в `Rzlzh.Patiences.Game.prototype.start`,
 * чтобы получить ссылку на объект игры, затем читаем состояние и выполняем
 * ходы через `playHistoryItem` — тот же путь, который сайт использует при
 * воспроизведении истории ходов.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GAME_URL = 'https://razlozhi.ru/patience-spider2';

/** Постоянный профиль браузера: куки и логин сохраняются между запусками. */
export const PROFILE_DIR = join(homedir(), '.razlozhi-spider-solver-profile');

/** Desktop-обёртка может задать свой профиль через env, чтобы не конфликтовать с CLI. */
const DEFAULT_PROFILE_DIR = () => process.env.SPIDER_PROFILE_DIR || PROFILE_DIR;

/** Устанавливает в страницу функции чтения состояния и выполнения ходов. */
function installHelpers() {
  const Game = window.Rzlzh?.Patiences?.Game;
  if (!Game) throw new Error('Rzlzh.Patiences.Game не найден');

  if (!window.__spiderHooked) {
    const originalStart = Game.prototype.start;
    Game.prototype.start = function (...args) {
      window.__spiderGame = this;
      return originalStart.apply(this, args);
    };
    window.__spiderHooked = true;
  }

  window.__readState = () => {
    const game = window.__spiderGame;
    if (!game) return null;
    const deck = game.getDeck();
    const toCard = (c) => (c.getSuit() - 3) * 13 + c.getNominal() - 1;

    const cols = deck._stacks.slice(0, 10).map((stack) => {
      const cards = stack.getCards();
      return {
        down: cards.filter((c) => !c.isFront()).map(toCard),
        up: cards.filter((c) => c.isFront()).map(toCard),
      };
    });

    const stock = deck.getCards().map(toCard);
    const remaining = stock.length + cols.reduce((n, c) => n + c.down.length + c.up.length, 0);
    const deals = (game._history || []).filter((h) => h.type === 'deckclick').length;

    return {
      cols,
      stock,
      foundations: (104 - remaining) / 13,
      moves: (game._history || []).filter((h) => h.type === 'movecards').length,
      deals,
      winner: game._winner.getValue(),
      freezed: game._freezed.getValue(),
    };
  };

  window.__executeMove = (move) => new Promise((resolve) => {
    const game = window.__spiderGame;
    if (!game) return resolve(false);
    const item = move.type === 'deal'
      ? { type: 'deckclick' }
      : { type: 'movecards', from: move.from, to: move.to, count: move.count };
    const timer = setTimeout(() => resolve(false), 8000);
    try {
      game.playHistoryItem(item, (ok) => {
        clearTimeout(timer);
        resolve(Boolean(ok));
      });
    } catch (err) {
      clearTimeout(timer);
      resolve(false);
    }
  });

  window.__deckCode = () => window.__spiderGame?._currentDeckCode.getValue() || null;
}

export class SpiderGame {
  constructor(page, { context = null, browser = null, profile = null } = {}) {
    this.page = page;
    this.context = context;
    this.browser = browser;
    this.profile = profile;
  }

  /**
   * По умолчанию используем постоянный профиль, чтобы логин, сделанный один
   * раз через `--login`, работал во всех последующих запусках.
   */
  static async launch({
    headless = false,
    url = GAME_URL,
    profile = DEFAULT_PROFILE_DIR(),
    persistent = true,
  } = {}) {
    let browser = null;
    let context;
    if (persistent) {
      mkdirSync(profile, { recursive: true });
      context = await chromium.launchPersistentContext(profile, {
        headless,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-dev-shm-usage'],
      });
    } else {
      browser = await chromium.launch({ headless, args: ['--disable-dev-shm-usage'] });
      context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    }

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.Rzlzh?.Patiences?.Game, null, { timeout: 20000 });
    await page.evaluate(installHelpers);
    return new SpiderGame(page, { context, browser, profile: persistent ? profile : null });
  }

  /**
   * Переоткрыть страницу игры. После OAuth вкладка может оказаться на
   * accounts.google.com, поэтому идём на канонический URL, а не делаем
   * page.reload() — иначе Rzlzh на странице никогда не появится.
   */
  async open(url = GAME_URL) {
    if (this.page.isClosed()) {
      this.page = this.context?.pages()[0] || await this.context.newPage();
      this.page.setDefaultTimeout(20000);
    }
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForFunction(() => !!window.Rzlzh?.Patiences?.Game, null, { timeout: 30000 });
    await this.page.evaluate(installHelpers);
  }

  async reload() {
    await this.open();
  }

  /** Конфиг страницы: поле user равно null до логина. */
  async readConfig() {
    return this.page.evaluate(() => {
      const script = [...document.scripts].find((s) => s.textContent.includes('runApp('));
      const text = script?.textContent || '';
      const start = text.indexOf('.apply(window, [');
      const end = text.lastIndexOf(']);');
      if (start === -1 || end <= start) return null;
      try {
        return JSON.parse(text.slice(start + '.apply(window, ['.length, end));
      } catch {
        return null;
      }
    });
  }

  async loginStatus() {
    const config = await this.readConfig();
    const hasLoginLink = await this.page.evaluate(() =>
      [...document.querySelectorAll('a')].some((a) => /Войти на сайт/i.test(a.textContent || '')));
    const user = config?.user || null;
    return { loggedIn: Boolean(user), user, hasLoginLink };
  }

  async startNewGame() {
    // После старта сайт скрывает кнопку «Начать новую игру», поэтому для
    // повторного запуска перезагружаем страницу и заново ставим перехватчики.
    const visible = await this.page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) =>
        /Начать новую игру|Новая игра/.test(b.textContent) && getComputedStyle(b).visibility !== 'hidden'));
    if (!visible) await this.reload();
    const button = this.page.getByRole('button', { name: /Начать новую игру|Новая игра/ }).first();
    await button.click();
    await this.page.waitForFunction(
      () => window.__spiderGame && window.__spiderGame._tableauEnabled.getValue()
        && !window.__spiderGame._freezed.getValue()
        && window.__spiderGame.getDeck().getCards().length === 50,
      null,
      { timeout: 30000 },
    );
  }

  /**
   * Ежедневная колода (deal of the day) запускается кнопкой «Разложить»
   * на стартовом экране. В отличие от startWithDeck, сайт получает
   * payload {mode:'dotd'} и записывает результат как ежедневный.
   */
  async startDailyGame() {
    const daily = await this.page.evaluate(() => {
      const script = [...document.scripts].find((s) => s.textContent.includes('"deckOfTheDay"'));
      const match = script?.textContent.match(
        /"deckOfTheDay":\{"date":"([^"]+)","deck":"([^"]+)"/,
      );
      return match ? { date: match[1], deck: match[2] } : null;
    });

    const visible = await this.page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) =>
        /^(Разложить|Переразложить|Доразложить)$/.test(b.textContent.trim())
        && getComputedStyle(b).visibility !== 'hidden'));
    if (!visible) await this.reload();

    const button = this.page.getByRole('button', { name: /^(Разложить|Переразложить|Доразложить)$/ }).first();
    await button.click();
    await this.page.waitForFunction(
      () => window.__spiderGame && window.__spiderGame.getDeck().getCards().length === 50
        && !window.__spiderGame._freezed.getValue(),
      null,
      { timeout: 30000 },
    );
    return daily;
  }

  async startWithDeck(code) {
    if (!await this.page.evaluate(() => !!window.__spiderGame)) {
      await this.startNewGame();
    }
    await this.page.evaluate((deckCode) => {
      window.__spiderGame.start(deckCode);
    }, code);
    await this.page.waitForFunction(
      () => !window.__spiderGame?._freezed.getValue()
        && window.__spiderGame.getDeck().getCards().length === 50,
      null,
      { timeout: 30000 },
    );
  }

  async readState() {
    return this.page.evaluate(() => window.__readState());
  }

  async deckCode() {
    return this.page.evaluate(() => window.__deckCode());
  }

  async executeMove(move) {
    const ok = await this.page.evaluate((m) => window.__executeMove(m), move);
    await this.page.waitForFunction(
      () => !window.__spiderGame?._freezed.getValue(),
      null,
      { timeout: 20000 },
    );
    return ok;
  }

  isWinner(state) {
    return Boolean(state?.winner);
  }

  async close() {
    // У постоянного контекста browser() равен null — закрываем сам контекст,
    // именно так куки и localStorage сохраняются на диске.
    try {
      await this.context?.close();
    } finally {
      await this.browser?.close();
    }
  }
}
