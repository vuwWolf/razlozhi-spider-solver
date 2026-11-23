import {
  createState, applyMove, generateMoves, isWin, hashState, evaluate,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

function topN(arr, n) {
  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, n);
}

function beam(deckCode, width = 300, maxSteps = 2000, dealPenalty = 200, noise = 0) {
  const root = { s: createState(deckCode), parent: null, move: null, depth: 0 };
  let states = [root];
  const seen = new Set([hashState(root.s)]);
  let bestNode = root;
  let bestScore = evaluate(root.s);

  for (let step = 0; step < maxSteps; step++) {
    const candidates = [];
    for (const node of states) {
      for (const m of generateMoves(node.s)) {
        const ns = applyMove(node.s, m);
        const h = hashState(ns);
        if (seen.has(h)) continue;
        seen.add(h);
        const child = { s: ns, parent: node, move: m, depth: node.depth + 1 };
        if (isWin(ns)) return { win: true, node: child, steps: step + 1 };
        const score = evaluate(ns, noise) - dealPenalty * ns.deals - ns.moves * 0.01;
        child.score = score;
        candidates.push(child);
      }
    }
    if (!candidates.length) break;
    states = topN(candidates, width);
    if (states[0].score > bestScore) { bestScore = states[0].score; bestNode = states[0]; }
    if (step % 50 === 0) {
      const s = states[0].s;
      console.log(`  step ${step}: best=${states[0].score.toFixed(0)} found=${s.foundations} hidden=${s.cols.reduce((a,c)=>a+c.down.length,0)} stock=${s.stock.length}`);
    }
  }
  return { win: false, node: bestNode };
}

function pathOf(node) {
  const out = [];
  while (node && node.move) { out.push(node.move); node = node.parent; }
  return out.reverse();
}

const idx = Number(process.argv[2] ?? 0);
const width = Number(process.argv[3] ?? 300);
const penalty = Number(process.argv[4] ?? 200);
console.log(`=== Deck ${idx + 1} (width=${width}, penalty=${penalty}) ===`);
const t = Date.now();
const r = beam(DECKS[idx], width, 3000, penalty);
console.log('result', r.win ? `WIN in ${r.steps} steps, ${pathOf(r.node).length} moves` : 'no win', `${Date.now() - t}ms`);
if (r.win || true) {
  const s = createState(DECKS[idx]);
  const p = pathOf(r.node);
  console.log('path length', p.length, 'found', r.node.s.foundations, 'hidden', r.node.s.cols.reduce((a,c)=>a+c.down.length,0), 'stock', r.node.s.stock.length);
  for (const m of p.slice(0, 15)) {
    console.log(' ', m.type === 'deal' ? 'deal' : `${m.from+1}->${m.to+1} k=${m.k} n=${m.count}`);
  }
}
