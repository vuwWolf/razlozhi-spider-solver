import {
  createState, applyMove, generateMoves, isWin, hashState, rankOf, suitOf, cardName,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

const hidden = (s) => s.cols.reduce((a, c) => a + c.down.length, 0);
const empty = (s) => s.cols.filter((c) => !c.up.length && !c.down.length).length;

function scoreMove(s, m) {
  if (m.type === 'deal') return 100;
  const src = s.cols[m.from];
  const dst = s.cols[m.to];
  const first = src.up[m.k];
  const revealing = src.down.length > 0 && m.k === 0;
  const sameSuit = dst.up.length > 0 && suitOf(first) === suitOf(dst.up[dst.up.length - 1]);
  const toEmpty = dst.up.length === 0;
  const king = rankOf(first) === 13;
  const breaksRun = m.k > 0 && suitOf(src.up[m.k - 1]) === suitOf(first) && src.up[m.k - 1] === first + 1;

  let cost = 50;
  if (revealing && sameSuit) cost = 0;
  else if (revealing && toEmpty && king) cost = 1;
  else if (revealing) cost = 2;
  else if (sameSuit && src.up.length - m.k > 1) cost = 3;
  else if (sameSuit) cost = 4;
  else if (toEmpty && king) cost = 5;
  else if (toEmpty) cost = 8;
  if (breaksRun) cost += 20;
  return cost;
}

function isUndo(prev, m) {
  if (!prev || prev.type !== 'move' || m.type !== 'move') return false;
  return prev.from === m.to && prev.to === m.from && prev.count === m.count;
}

function dfs(state, maxNodes = 200000, maxDepth = 600) {
  let nodes = 0;
  const path = [];
  const seen = new Set();

  function rec(s, depth, last) {
    if (isWin(s)) return true;
    if (depth >= maxDepth || nodes >= maxNodes) return false;
    nodes++;
    const h = hashState(s);
    if (seen.has(h)) return false;
    seen.add(h);

    const moves = generateMoves(s).filter((m) => !isUndo(last, m));
    moves.sort((a, b) => scoreMove(s, a) - scoreMove(s, b));

    for (const m of moves) {
      const ns = applyMove(s, m);
      path.push(m);
      if (rec(ns, depth + 1, m)) return true;
      path.pop();
    }
    return false;
  }

  const won = rec(state, 0, null);
  return { won, path, nodes };
}

for (const [i, deck] of DECKS.entries()) {
  const t = Date.now();
  const r = dfs(createState(deck), 150000, 500);
  console.log(`Deck ${i + 1}:`, r.won ? `WIN in ${r.path.length} moves` : 'no win', `nodes=${r.nodes}`, `${Date.now() - t}ms`);
  if (r.won) {
    let s = createState(deck);
    for (const m of r.path.slice(0, 25)) {
      console.log(' ', m.type === 'deal' ? 'deal' : `${cardName(s.cols[m.from].up[m.k])} c${m.from+1}->c${m.to+1}`);
      s = applyMove(s, m);
    }
    console.log('  ...', r.path.length, 'total moves');
  }
}
