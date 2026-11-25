/**
 * Драйвер игры для десктопной версии без Playwright и отдельного окна.
 *
 * Electron уже содержит Chromium, поэтому страница razlozhi.ru загружается в
 * WebContentsView внутри главного окна приложения. Управление идёт через
 * webContents.executeJavaScript с теми же хелперами, что использует
 * Playwright-драйвер. Ходы по-прежнему выполняются через playHistoryItem.
 */
import { installHelpers } from './page-helpers.js';

export const GAME_URL = 'https://razlozhi.ru/patience-spider2';

const READ_CONFIG = `(() => {
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
})()`;

const READ_DAILY = `(() => {
  const script = [...document.scripts].find((s) => s.textContent.includes('"deckOfTheDay"'));
  const marker = '"deckOfTheDay":{';
  const i = script?.textContent.indexOf(marker) ?? -1;
  if (i === -1) return null;
  const tail = script.textContent.slice(i + marker.length);
  const match = tail.match(/"date":"([^"]+)","deck":"([^"]+)"/);
  return match ? { date: match[1], deck: match[2] } : null;
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class EmbeddedSpiderGame {
  /**
   * @param {import('electron').WebContentsView} view встроенный вид страницы игры
   * @param {{ profile?: string|null }} options
   */
  constructor(view, { profile = null } = {}) {
    if (!view?.webContents) throw new Error('WebContentsView не передан в EmbeddedSpiderGame');
    this.view = view;
    this.webContents = view.webContents;
    this.profile = profile;
  }

  eval(code) {
    return this.webContents.executeJavaScript(code, true);
  }

  async waitFor(expression, timeout = 30000, interval = 100) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(`Boolean(${expression})`)) return true;
      } catch {
        // страница может перезагружаться — пробуем ещё
      }
      await sleep(interval);
    }
    throw new Error(`таймаут ожидания: ${expression}`);
  }

  async open(url = GAME_URL) {
    await this.webContents.loadURL(url);
    await this.waitFor('!!window.Rzlzh?.Patiences?.Game');
    await this.eval(`(${installHelpers.toString()})()`);
    await this.attachDebugger();
  }

  async attachDebugger() {
    const inspector = this.webContents.debugger;
    if (!inspector.isAttached()) {
      inspector.attach('1.3');
      await inspector.sendCommand('Page.enable');
      await inspector.sendCommand('Page.bringToFront');
      await inspector.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
  }

  async pageInfo() {
    return this.eval(`(() => ({
      url: location.href,
      title: document.title,
      ready: document.readyState,
      hasGame: !!window.Rzlzh?.Patiences?.Game,
      hasInstance: !!window.__spiderGame,
      buttons: [...document.querySelectorAll('button')]
        .map((b) => b.textContent.trim()).filter(Boolean).slice(0, 12),
    }))()`).catch((err) => ({ error: err?.message || String(err) }));
  }

  async waitForGameStart(expression) {
    try {
      await this.waitFor(expression);
    } catch (err) {
      const info = await this.pageInfo();
      throw new Error(`${err.message}; страница: ${JSON.stringify(info)}`);
    }
  }

  async reload() {
    await this.open();
  }

  async clickButton(pattern) {
    const rect = await this.eval(`(() => {
      const re = ${pattern.toString()};
      const button = [...document.querySelectorAll('button')].find((b) =>
        re.test(b.textContent.trim()) && getComputedStyle(b).visibility !== 'hidden');
      if (!button) return null;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      const r = button.getBoundingClientRect();
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    })()`);
    if (!rect) throw new Error(`кнопка не найдена: ${pattern}`);

    // button.click() создаёт недоверенное событие, которое сайт игнорирует.
    // Отправляем настоящие события мыши через CDP вебконтента.
    const inspector = this.webContents.debugger;
    await this.attachDebugger();
    this.webContents.focus();
    const { x, y } = rect;
    await inspector.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y,
    });
    await inspector.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    await inspector.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
  }

  async startNewGame() {
    await this.open(GAME_URL);
    await this.clickButton(/Начать новую игру|Новая игра/);
    await this.waitForGameStart(
      'window.__spiderGame && window.__spiderGame._tableauEnabled.getValue()'
      + ' && !window.__spiderGame._freezed.getValue()'
      + ' && window.__spiderGame.getDeck().getCards().length === 50',
    );
  }

  async startDailyGame() {
    const daily = await this.eval(READ_DAILY);
    await this.open(GAME_URL);
    await this.clickButton(/^(Разложить|Переразложить|Доразложить)$/);
    await this.waitForGameStart(
      'window.__spiderGame && window.__spiderGame.getDeck().getCards().length === 50'
      + ' && !window.__spiderGame._freezed.getValue()',
    );
    return daily;
  }

  async startWithDeck(code) {
    if (!await this.eval('!!window.__spiderGame')) await this.startNewGame();
    await this.eval(`window.__spiderGame.start(${JSON.stringify(code)})`);
    await this.waitFor(
      '!window.__spiderGame?._freezed.getValue()'
      + ' && window.__spiderGame.getDeck().getCards().length === 50',
    );
  }

  readState() {
    return this.eval('window.__readState()');
  }

  deckCode() {
    return this.eval('window.__deckCode()');
  }

  readConfig() {
    return this.eval(READ_CONFIG);
  }

  async loginStatus() {
    const config = await this.readConfig();
    const hasLoginLink = await this.eval(
      '[...document.querySelectorAll("a")].some((a) => /Войти на сайт/i.test(a.textContent || ""))',
    );
    const user = config?.user || null;
    return { loggedIn: Boolean(user), user, hasLoginLink };
  }

  async executeMove(move) {
    const ok = await this.eval(`window.__executeMove(${JSON.stringify(move)})`);
    await this.waitFor('!window.__spiderGame?._freezed.getValue()', 20000);
    return ok;
  }

  isWinner(state) {
    return Boolean(state?.winner);
  }

  /** Вид принадлежит главному окну и живёт между запусками — не.destroy его. */
  async close() {
    // Runner открывает игру заново в том же встроенном виде.
    try {
      if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach();
    } catch {
      // Отладчик мог быть отключён вместе с окном — это не ошибка.
    }
  }
}
