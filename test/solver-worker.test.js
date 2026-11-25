import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyMove, isWin } from '../src/model.js';
import { solveInWorker, stopSolver, closeSolver } from '../src/solver-client.js';

const DECK = '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx';

test('поиск в отдельном потоке возвращает настоящую победу и прогресс', async () => {
  const progress = [];
  const result = await solveInWorker(
    createState(DECK),
    { restarts: 2, maxSteps: 1500, timeLimitMs: 20000 },
    (event) => progress.push(event),
  );

  assert.equal(result?.won, true);
  assert.ok(progress.some((event) => event.kind === 'attempt'));
  let state = createState(DECK);
  for (const move of result.moves) state = applyMove(state, move);
  assert.ok(isWin(state));
});

test('стоп прерывает поиск, следующий запуск работает нормально', async () => {
  const started = Date.now();
  const search = solveInWorker(createState(DECK), {
    restarts: 1000, maxSteps: 100000, timeLimitMs: 600000,
  });
  setTimeout(() => stopSolver(), 100);

  assert.equal(await search, null);
  assert.ok(Date.now() - started < 10000, 'поиск должен прерываться быстро');

  const next = await solveInWorker(createState(DECK), {
    restarts: 2, maxSteps: 1500, timeLimitMs: 20000,
  });
  assert.equal(next?.won, true);

  await closeSolver();
});
