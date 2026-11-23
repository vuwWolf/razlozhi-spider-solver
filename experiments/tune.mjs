import {
  createState, applyMove, generateMoves, isWin, hashState, rankOf, suitOf, runs,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

const hidden = (s) => s.cols.reduce((a, c) => a + c.down.length, 0);
const isUndo = (p, m) => p && p.type === 'move' && m.type === 'move'
  && p.from === m.to && p.to === m.from && p.count === m.count;

function makeScorer(w) {
  return (s) => {
    let score = 1000000 * s.foundations;
    const h = hidden(s);
    const empty = s.cols.filter((c) => c.down.length === 0 && c.up.length === 0).length;
    score -= w.hidden * h;
    score += w.empty * empty;
    let pairs = 0;
    let runBonus = 0;
    for (const col of s.cols) {
      for (const run of runs(col.up)) {
        pairs += run.length - 1;
        runBonus += (run.length - 1) ** 2;
        if (rankOf(run[0]) === 13) runBonus += w.king;
      }
      if (col.up.length) {
        const top = rankOf(col.up[col.up.length - 1]);
        score += w.top * (14 - top);
      }
    }
    score += w.pairs * pairs + w.run * runBonus;
    score -= w.deal * s.deals;
    score -= w.move * s.moves;
    return score;
  };
}

function playout(deck, w, seedNoise, maxSteps = 900) {
  const score = makeScorer(w);
  let s = createState(deck);
  let last = null;
  const seen = new Set();
  for (let step = 0; step < maxSteps; step++) {
    if (isWin(s)) return { win: true, moves: step, state: s };
    const key = hashState(s);
    if (seen.has(key)) return { win: false, state: s, reason: 'cycle' };
    seen.add(key);
    if (seen.size > 500) seen.clear();

    const moves = generateMoves(s).filter((m) => !isUndo(last, m));
    if (!moves.length) return { win: false, state: s, reason: 'stuck' };

    const scored = moves.map((m) => {
      const ns = applyMove(s, m);
      return { m, ns, v: score(ns) + (Math.random() - 0.5) * seedNoise };
    });
    scored.sort((a, b) => b.v - a.v);
    const pool = scored.slice(0, Math.min(4, scored.length));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    s = pick.ns;
    last = pick.m;
  }
  return { win: false, state: s, reason: 'limit' };
}

const BASE = { hidden: 300, empty: 120, pairs: 12, run: 2, king: 25, top: 0.5, deal: 115, move: 0.5 };
const variants = [];
for (const empty of [120, 300, 600, 1000]) {
  for (const hidden of [200, 300, 500]) {
    for (const deal of [50, 115, 300]) {
      variants.push({ ...BASE, empty, hidden, deal });
    }
  }
}

const TRIALS = Number(process.argv[2] ?? 60);
const results = [];
for (const w of variants) {
  let wins = 0;
  let bestH = 100;
  let bestF = 0;
  for (let i = 0; i < TRIALS; i++) {
    const r = playout(DECKS[i % DECKS.length], w, 20 + (i % 10) * 15);
    if (r.win) wins++;
    const h = hidden(r.state);
    if (h < bestH || r.state.foundations > bestF) { bestH = h; bestF = r.state.foundations; }
  }
  results.push({ w, wins, bestH, bestF });
}
results.sort((a, b) => b.wins - a.wins || b.bestF - a.bestF || a.bestH - b.bestH);
for (const r of results.slice(0, 12)) {
  console.log(`wins=${r.wins}/${TRIALS} bestFound=${r.bestF} bestHidden=${r.bestH} empty=${r.w.empty} hidden=${r.w.hidden} deal=${r.w.deal}`);
}
