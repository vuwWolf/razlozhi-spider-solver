import { SpiderGame } from '../src/browser.js';

const g = await SpiderGame.launch({ headless: true });
await g.startNewGame();

const result = await g.page.evaluate(async () => {
  const game = window.__spiderGame;
  const deck = game.getDeck();
  const stacks = deck.getStacks();
  const stackIndex = new Map(stacks.map((s, i) => [s, i]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const exec = (item) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    try { game.playHistoryItem(item, (ok) => { clearTimeout(timer); resolve(Boolean(ok)); }); }
    catch { clearTimeout(timer); resolve(false); }
  });
  const waitIdle = async () => {
    for (let i = 0; i < 200; i++) {
      if (!game._freezed.getValue()) return true;
      await sleep(25);
    }
    return false;
  };

  const log = [];
  let lastKey = '';
  let repeats = 0;
  for (let step = 0; step < 1200; step++) {
    if (game._winner.getValue()) return { win: true, steps: step, log: log.slice(-10) };
    await waitIdle();
    game._recalcHints();
    const hints = (game._hints || []).slice().sort((a, b) => b.weight - a.weight);
    let ok = false;
    if (hints.length) {
      const h = hints[0];
      const from = stackIndex.get(h.cards?.[0]?.getContainer?.());
      const to = stackIndex.get(h.target);
      const count = h.cards?.length;
      const key = `${from}:${to}:${count}`;
      if (key === lastKey) repeats++; else { lastKey = key; repeats = 0; }
      if (repeatGuard(repeats)) break;
      ok = await exec({ type: 'movecards', from, to, count });
      if (!ok) return { win: false, reason: 'move failed', step, from, to, count, log: log.slice(-10) };
      log.push(`${from}->${to} n=${count} w=${h.weight}`);
    } else {
      // no hint: try deal
      if (deck.getCards().length === 0) return { win: false, reason: 'stuck', step, log: log.slice(-10) };
      ok = await exec({ type: 'deckclick' });
      if (!ok) return { win: false, reason: 'deal failed', step, log: log.slice(-10) };
      log.push('deal');
      lastKey = '';
      repeats = 0;
    }
  }
  function repeatGuard(r) { return r > 30; }
  const state = window.__readState();
  return {
    win: false, reason: 'limit',
    foundations: state.foundations,
    hidden: state.cols.reduce((a, c) => a + c.down.length, 0),
    stock: state.stock.length,
    log: log.slice(-10),
  };
});

console.log(JSON.stringify(result, null, 2));
await g.close();
