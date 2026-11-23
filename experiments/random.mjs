import {
  createState, applyMove, generateMoves, isWin, hashState, rankOf, suitOf, cardName,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

const hidden = (s) => s.cols.reduce((a, c) => a + c.down.length, 0);
const isUndo = (p, m) => p && p.type === 'move' && m.type === 'move' && p.from === m.to && p.to === m.from && p.count === m.count;

function moveQuality(s, m) {
  if (m.type === 'deal') return 3;
  const src = s.cols[m.from], dst = s.cols[m.to];
  const first = src.up[m.k];
  const revealing = src.down.length > 0 && m.k === 0;
  const same = dst.up.length > 0 && suitOf(first) === suitOf(dst.up[dst.up.length - 1]);
  if (revealing && same) return 0;
  if (revealing) return 1;
  if (same) return 2;
  return 4;
}

function playout(deck, maxSteps = 1500) {
  let s = createState(deck);
  let last = null;
  const seen = new Set();
  let stagnant = 0;
  let prevHidden = hidden(s);
  const moves = [];

  for (let step = 0; step < maxSteps; step++) {
    if (isWin(s)) return { win: true, moves };
    const h = hashState(s);
    // only track recent states to avoid false cycles from long loops
    if (seen.has(h)) return { win: false, reason: 'cycle', step, state: s };
    seen.add(h);
    if (seen.size > 400) seen.clear();

    const candidates = generateMoves(s).filter((m) => !isUndo(last, m));
    if (!candidates.length) return { win: false, reason: 'stuck', step, state: s };

    const byQ = new Map();
    for (const m of candidates) {
      const q = moveQuality(s, m);
      if (!byQ.has(q)) byQ.set(q, []);
      byQ.get(q).push(m);
    }
    const qs = [...byQ.keys()].sort((a, b) => a - b);

    let chosen;
    if (stagnant > 15 && byQ.has(3)) {
      chosen = byQ.get(3)[0]; // force deal
      stagnant = 0;
    } else {
      const q = qs[0];
      const pool = byQ.get(q);
      chosen = pool[Math.floor(Math.random() * pool.length)];
    }

    s = applyMove(s, chosen);
    moves.push(chosen);
    last = chosen;
    const hn = hidden(s);
    if (hn < prevHidden) { stagnant = 0; prevHidden = hn; }
    else stagnant++;
  }
  return { win: false, reason: 'limit', state: s };
}

for (const [i, deck] of DECKS.entries()) {
  let best = null;
  let won = false;
  const N = 5000;
  for (let a = 0; a < N; a++) {
    const r = playout(deck);
    if (r.win) { console.log(`Deck ${i+1}: WIN on attempt ${a+1} in ${r.moves.length} moves`); won = true; break; }
    if (!best || (hidden(r.state) < hidden(best.state)) || (r.state.foundations > best.state.foundations)) best = r;
  }
  if (!won) console.log(`Deck ${i+1}: no win in ${N} attempts; best hidden=${hidden(best.state)} found=${best.state.foundations} stock=${best.state.stock.length}`);
}
