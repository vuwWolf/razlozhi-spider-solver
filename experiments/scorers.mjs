import { createState, rankOf, runs } from '../src/model.js';
import { beamSolve } from '../src/solver.js';

const DECKS = {
  hard: '7sk15j046hxtnjqjz7z834kqo32s19o2otkn8tiiq50tz30hh4p8ym9n2039yx6l8rmoy5lq1skr56yhn6xr19ipmimlxs7l72rjpp4z',
  d1: '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  d2: '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
};

function makeScorer(o) {
  return (s, noise = 0) => {
    let score = 1000000 * s.foundations;
    const hidden = s.cols.reduce((a, c) => a + c.down.length, 0);
    const empty = s.cols.filter((c) => c.down.length === 0 && c.up.length === 0).length;
    score -= 300 * hidden;
    score += 120 * empty;
    let pairs = 0, rb = 0;
    for (const col of s.cols) {
      for (const run of runs(col.up)) {
        pairs += run.length - 1;
        rb += (run.length - 1) ** 2;
        if (rankOf(run[0]) === 13) rb += o.king;
        if (run.length === 12) rb += o.near;
      }
      if (col.up.length) score += o.top * (o.topSign * rankOf(col.up[col.up.length - 1]));
    }
    score += 12 * pairs + 80 * rb - 0.5 * s.moves;
    return noise ? score + (Math.random() - 0.5) * noise : score;
  };
}

const VARIANTS = {
  base: { king: 25, near: 0, top: 0.5, topSign: -1 },
  topFlip: { king: 25, near: 0, top: 0.5, topSign: 1 },
  topStrong: { king: 25, near: 0, top: 2, topSign: 1 },
  topNone: { king: 25, near: 0, top: 0, topSign: 1 },
  near150: { king: 25, near: 150, top: 0.5, topSign: -1 },
  king100: { king: 100, near: 0, top: 0.5, topSign: -1 },
};

const which = process.argv[2] || 'hard';
const code = DECKS[which];
const pen = which === 'hard' ? 2000 : 100;
for (const [name, o] of Object.entries(VARIANTS)) {
  const t = Date.now();
  const r = beamSolve(createState(code), {
    scorer: makeScorer(o), width: 200, dealPenalty: pen, timeLimitMs: 15000, maxSteps: 2000,
  });
  console.log(`${which} ${name}: won=${r.won} found=${r.foundations} moves=${r.moves.length} nodes=${r.nodes} ms=${Date.now() - t}`);
}
