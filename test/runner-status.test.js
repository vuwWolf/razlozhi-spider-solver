import test from 'node:test';
import assert from 'node:assert/strict';
import { Runner } from '../src/runner.js';

test('рассылаемый статус содержит флаг running', () => {
  const runner = new Runner();
  const seen = [];
  runner.on('status', (status) => seen.push(status));

  runner.running = true;
  runner.setStatus({ phase: 'solving' });
  assert.equal(seen.at(-1).running, true);

  runner.running = false;
  runner.setStatus({ phase: 'idle' });
  assert.equal(seen.at(-1).running, false);
});

test('после завершения запуска рассылается running=false', async () => {
  const runner = new Runner({
    createGame: async () => {
      throw new Error('тестовая ошибка');
    },
  });
  const seen = [];
  runner.on('status', (status) => seen.push(status));

  await runner.start({ mode: 'deck', deck: 'x'.repeat(104) });

  assert.equal(seen.at(-1).running, false);
  assert.equal(seen.at(-1).phase, 'error');
});
