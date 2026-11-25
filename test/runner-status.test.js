import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createState } from '../src/model.js';
import { Runner } from '../src/runner.js';
import { closeSolver } from '../src/solver-client.js';

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

test('Runner по флагу из интерфейса сохраняет найденные ходы в файл', async () => {
  const deck = '8xzm4s809p544t6kxzyi1ko514rloi6j36tz307jn5qsjxs3kqt1mhlp0krr077nz27oh2trl2nh5m3ypq8ji1moilqps29ny86h99yx';
  const initial = createState(deck);
  const snapshot = {
    cols: initial.cols.map((col) => ({ down: [...col.down], up: [...col.up] })),
    stock: [...initial.stock],
    foundations: 0,
    winner: true,
  };
  const game = {
    startWithDeck: async () => {},
    deckCode: async () => deck,
    readState: async () => snapshot,
    executeMove: async () => true,
    close: async () => {},
  };

  const dir = await mkdtemp(path.join(os.tmpdir(), 'spider-moves-'));
  const previousDir = process.env.SPIDER_LOG_DIR;
  process.env.SPIDER_LOG_DIR = dir;

  try {
    const runner = new Runner({ createGame: async () => game });
    const statuses = [];
    runner.on('status', (status) => statuses.push(status));

    await runner.start({ mode: 'deck', deck, logMoves: true });

    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^spider-moves-.*-1\.txt$/);
    const text = await readFile(path.join(dir, files[0]), 'utf8');
    assert.match(text, /Ходов: \d+/);
    assert.match(text, new RegExp(`Колода: ${deck}`));
    assert.ok(statuses.some((status) => status.logFile === path.join(dir, files[0])));
  } finally {
    if (previousDir === undefined) delete process.env.SPIDER_LOG_DIR;
    else process.env.SPIDER_LOG_DIR = previousDir;
    await closeSolver();
    await rm(dir, { recursive: true, force: true });
  }
});
