import {
  createState, applyMove, generateMoves, isWin, hashState, evaluate, rankOf, suitOf,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

const hidden = (s) => s.cols.reduce((a, c) => a + c.down.length, 0);
const isUndo = (p, m) => p && p.type === 'move' && m.type === 'move'
  && p.from === m.to && p.to === m.from && p.count === m.count;

function baseScore(s) {
  let score = evaluate(s) - 200 * s.deals;
  //бонус за почти завершённые последовательности (12 карт)
  for (const col of s.cols) {
    let run = [];
    for (const card of col.up) {
      if (run.length && card === run[run.length - 1] - 1) run.push(card);
      else run = [card];
      if (run.length === 12) score += 500;
    }
  }
  return score;
}

function playout(deck, noise, maxSteps = 1200) {
  let s = createState(deck);
  let last = null;
  const seen = new Set();
  let best = { score: baseScore(s), state: s };
  let stagnant = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (isWin(s)) return { win: true, steps: step };
    const h = hashState(s);
    if (seen.has(h)) return { win: false, reason: 'cycle', state: best.state };
    seen.add(h);
    if (seen.size > 600) seen.clear();

    const moves = generateMoves(s).filter((m) => !isUndo(last, m));
    if (!moves.length) return { win: false, reason: 'stuck', state: best.state };

    const scored = moves.map((m) => {
      const ns = applyMove(s, m);
      return { m, ns, score: baseScore(ns) + (Math.random() - 0.5) * noise };
    });
    scored.sort((a, b) => b.score - a.score);

    // случайный выбор из топ-3 для разнообразия
    const pool = scored.slice(0, 3);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    s = pick.ns;
    last = pick.m;

    const realScore = baseScore(s);
    if (realScore > best.score) { best = { score: realScore, state: s }; stagnant = 0; }
    else stagnant++;
    if (stagnant > 60) {
      // 强制推进：直接执行可用发牌
      const deal = moves.find((m) => m.type === 'deal');
      if (deal) { s = applyMove(s, deal); last = deal; stagnant = 0; }
    }
  }
  return { win: false, reason: 'limit', state: best.state };
}

const N = Number(process.argv[2] ?? 2000);
for (const [i, deck] of DECKS.entries()) {
  let won = false;
  let best = null;
  for (let a = 0; a < N; a++) {
    const noise = 20 + (a % 20) * 20;
    const r = playout(deck, noise);
    if (r.win) { console.log(`Deck ${i+1}: WIN on attempt ${a+1} in ${r.steps} moves`); won = true; break; }
    if (!best || hidden(r.state) < hidden(best) || r.state.foundations > best.foundations) best = r.state;
  }
  if (!won) console.log(`Deck ${i+1}: no win in ${N} attempts; best hidden=${hidden(best)} found=${best.foundations} stock=${best.stock.length}`);
}
