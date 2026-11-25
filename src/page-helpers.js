/**
 * Код, который внедряется в страницу игры.
 *
 * Модуль не имеет внешних зависимостей, поэтому его могут использовать и
 * Playwright-драйвер (`page.evaluate`), и встроенный Electron-драйвер
 * (`webContents.executeJavaScript`).
 */
export function installHelpers() {
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
