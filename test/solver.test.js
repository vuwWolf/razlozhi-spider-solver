import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyMove, isWin } from '../src/model.js';
import { beamSolve, solveWithRestarts } from '../src/solver.js';

const DECKS = [
  '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx',
  '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l',
];

for (const [i, deck] of DECKS.entries()) {
  test(`решатель находит настоящую победу (колода ${i + 1})`, () => {
    const result = beamSolve(createState(deck), { timeLimitMs: 20000 });
    assert.equal(result.won, true, 'решатель должен найти победу');

    // Прогоняем найденные ходы через модель ещё раз — это guard от
    // нелегальных ходов и «фальшивых» побед.
    let state = createState(deck);
    for (const move of result.moves) state = applyMove(state, move);
    assert.ok(isWin(state), ' replayed moves must genuinely win');
  });
}

test('portfolio restarts находит решение на сложной колоде', () => {
  const deck = '3hjh0t4y7hzylssxo56qk2x16ok2l83k463t549mzmrx0liqn271prisjm81ppqt0z5i5z7s03jxo9yl1748tjyk99rhnqpni8n26mor';
  const result = solveWithRestarts(createState(deck), { restarts: 5, timeLimitMs: 20000 });
  assert.ok(result, ' portfolio should find a solution');
  let state = createState(deck);
  for (const move of result.moves) state = applyMove(state, move);
  assert.ok(isWin(state));
});
