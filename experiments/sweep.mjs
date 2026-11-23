import { createState, rankOf, suitOf, runs } from '../src/model.js';
import { beamSolve } from '../src/solver.js';

const DECK = '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx';

function scorerFor(w) {
  return (s, noise = 0) => {
    let score = 1000000 * s.foundations;
    const hidden = s.cols.reduce((a, c) => a + c.down.length, 0);
    const empty = s.cols.filter((c) => c.down.length === 0 && c.up.length === 0).length;
    score -= w.hidden * hidden;
    score += w.empty * empty;
    let pairs = 0, runBonus = 0;
    for (const col of s.cols) {
      for (const run of runs(col.up)) {
        pairs += run.length - 1;
        runBonus += (run.length - 1) ** 2;
        if (rankOf(run[0]) === 13) runBonus += w.king;
      }
      if (col.up.length) score += w.top * (14 - rankOf(col.up[col.up.length - 1]));
    }
    score += w.pairs * pairs + w.run * runBonus;
    score -= w.move * s.moves;
    return noise ? score + (Math.random() - 0.5) * noise : score;
  };
}

const BASE = { hidden: 300, empty: 120, pairs: 12, run: 2, king: 25, top: 0.5, move: 0.5 };
const variants = [];
for (const hidden of [50, 100, 200, 300]) {
  for (const run of [2, 10, 30, 80]) {
    for (const empty of [120, 400, 800]) {
      variants.push({ ...BASE, hidden, run, empty });
    }
  }
}

const results = [];
for (const w of variants) {
  const r = beamSolve(createState(DECK), {
    scorer: scorerFor(w),
    width: 200, maxSteps: 700, timeLimitMs: 12000, dealPenalty: 100,
  });
  results.push({ w, found: r.foundations, won: r.won, moves: r.moves.length });
  process.stderr.write('.');
}
process.stderr.write('\n');
results.sort((a, b) => b.found - a.found || Number(b.won) - Number(a.won));
for (const r of results.slice(0, 20)) {
  console.log(`found=${r.found} won=${r.won} hidden=${r.w.hidden} run=${r.w.run} empty=${r.w.empty} pairs=${r.w.pairs}`);
}
