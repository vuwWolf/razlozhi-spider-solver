import {
  createState, applyMove, generateMoves, isWin, hashState, rankOf, suitOf, runs,
} from '../src/model.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

function hidden(s) { return s.cols.reduce((a, c) => a + c.down.length, 0); }

function moveScore(s, m, last) {
  if (m.type === 'deal') return 0;
  const src = s.cols[m.from];
  const dst = s.cols[m.to];
  const first = src.up[m.k];
  const seq = src.up.slice(m.k);
  const reveals = src.down.length > 0 && m.k === 0;
  const completes = seq.length === 13 && suitOf(first) === suitOf(seq[12]);
  const sameSuitDst = dst.up.length > 0 && suitOf(first) === suitOf(dst.up[dst.up.length - 1]);
  const emptyDst = dst.up.length === 0;
  let v = 0;
  if (completes) v += 100000;
  if (reveals) v += 5000;
  if (sameSuitDst) v += 1000 + seq.length * 50;
  if (emptyDst) v += rankOf(first) === 13 ? 800 : 200;
  if (emptyDst && rankOf(first) === 13) v += 400;
  // prefer moving larger same-suit stacks
  const movedRun = runs(seq)[0];
  if (movedRun && movedRun.length === seq.length) v += seq.length * 20;
  // avoid undoing
  if (last && last.type === 'move' && last.from === m.to && last.to === m.from && last.count === m.count) v -= 100000;
  return v;
}

function solve(deck, budget = 2000000) {
  const root = createState(deck);
  const seen = new Map();
  const path = [];
  let nodes = 0;
  let best = { found: 0, hidden: hidden(root) };

  function dfs(s, depth, last) {
    if (++nodes > budget) return false;
    if (isWin(s)) return true;
    if (s.foundations > best.found || (s.foundations === best.found && hidden(s) < best.hidden)) {
      best = { found: s.foundations, hidden: hidden(s), depth };
      if (best.found >= 7 && best.hidden <= 2) process.stderr.write(`best ${JSON.stringify(best)} nodes=${nodes}\n`);
    }
    const key = hashState(s);
    const prevDepth = seen.get(key);
    if (prevDepth !== undefined && prevDepth <= depth) return false;
    seen.set(key, depth);
    if (seen.size > 900000) seen.clear();

    const moves = generateMoves(s);
    moves.sort((a, b) => moveScore(s, b, last) - moveScore(s, a, last));
    for (const m of moves) {
      path.push(m);
      if (dfs(applyMove(s, m), depth + 1, m)) return true;
      path.pop();
      if (nodes > budget) return false;
    }
    return false;
  }

  const won = dfs(root, 0, null);
  return { won, path: won ? path.slice() : [], nodes, best, seen: seen.size };
}

const idx = Number(process.argv[2] ?? 0);
const budget = Number(process.argv[3] ?? 2000000);
const t = Date.now();
const r = solve(DECKS[idx], budget);
let s = createState(DECKS[idx]);
if (r.won) for (const m of r.path) s = applyMove(s, m);
console.log('deck', idx + 1, 'won', r.won, 'verified', isWin(s), 'found', r.best.found,
  'hidden', r.best.hidden, 'moves', r.path.length, 'nodes', r.nodes, 'seen', r.seen, 'ms', Date.now() - t,
  'heapMB', Math.round(process.memoryUsage().heapUsed / 1048576));
