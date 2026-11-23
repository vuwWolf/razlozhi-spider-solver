import {
  createState, applyMove, generateMoves, isWin, hashState, rankOf, suitOf, cardName,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function hiddenCount(s) { return s.cols.reduce((a, c) => a + c.down.length, 0); }
function emptyCount(s) { return s.cols.filter((c) => !c.down.length && !c.up.length).length; }

function classify(s, m) {
  if (m.type === 'deal') return 6;
  const src = s.cols[m.from];
  const dst = s.cols[m.to];
  const moved = src.up.slice(m.k);
  const first = moved[0];
  const revealing = src.down.length > 0 && m.k === 0;
  const sameSuit = dst.up.length > 0 && suitOf(first) === suitOf(dst.up[dst.up.length - 1]);
  const toEmpty = dst.up.length === 0;
  const king = rankOf(first) === 13;

  if (revealing && sameSuit) return 0;      // uncover + merge run
  if (revealing && toEmpty && king) return 1; // uncover + king to empty
  if (revealing) return 2;                  // uncover
  if (sameSuit && moved.length > 1) return 3; // merge runs
  if (sameSuit) return 4;                   // extend same-suit
  if (toEmpty && king) return 5;            // king to empty
  return 7;                                 // generic move
}

function solveOnce(deckCode, maxSteps = 2000) {
  let s = createState(deckCode);
  const seen = new Set();
  for (let step = 0; step < maxSteps; step++) {
    if (isWin(s)) return { win: true, moves: step, state: s };
    const h = hashState(s);
    if (seen.has(h)) return { win: false, reason: 'cycle', step, state: s };
    seen.add(h);

    const moves = generateMoves(s);
    if (!moves.length) return { win: false, reason: 'stuck', step, state: s };

    const groups = new Map();
    for (const m of moves) {
      const c = classify(s, m);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(m);
    }
    const priority = [...groups.keys()].sort((a, b) => a - b);
    const best = priority[0];
    // among equally-ranked moves, prefer ones that keep more options and fewer broken runs
    const candidates = groups.get(best);
    let chosen;
    if (best === 9) {
      chosen = candidates[0];
    } else {
      const scored = candidates.map((m) => {
        const ns = applyMove(s, m);
        const nHidden = hiddenCount(ns);
        const nEmpty = emptyCount(ns);
        // prefer fewer hidden, more empty, and moves that don't waste long runs
        const waste = m.type === 'move' && m.k > 0 && rankOf(s.cols[m.from].up[m.k - 1]) - rankOf(s.cols[m.from].up[m.k]) === 1 && suitOf(s.cols[m.from].up[m.k - 1]) === suitOf(s.cols[m.from].up[m.k]) ? -3 : 0;
        return { m, score: -nHidden * 10 + nEmpty * 5 + waste + Math.random() * 0.5 };
      });
      scored.sort((a, b) => b.score - a.score);
      chosen = scored[0].m;
    }
    s = applyMove(s, chosen);
  }
  return { win: false, reason: 'limit', state: s };
}

for (const [i, deck] of DECKS.entries()) {
  const results = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = solveOnce(deck);
    if (r.win) { console.log(`Deck ${i+1}: WIN on attempt ${attempt+1} in ${r.moves} moves`); break; }
    results.push(r.reason);
  }
  if (!results.length) continue;
  const counts = results.reduce((a, r) => (a[r] = (a[r] || 0) + 1, a), {});
  const last = solveOnce(deck);
  console.log(`Deck ${i+1}: no win in ${results.length} attempts`, counts, 'best hidden', hiddenCount(last.state), 'found', last.state.foundations, 'stock', last.state.stock.length);
}
