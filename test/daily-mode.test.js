import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannedGames } from '../src/modes.js';
import { Runner } from '../src/runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('ежедневная колода всегда планирует одну игру', () => {
  assert.equal(plannedGames({ daily: true, games: 10 }), 1);
  assert.equal(plannedGames({ mode: 'daily', games: 25 }), 1);
  assert.equal(plannedGames({ mode: 'daily' }), 1);
});

test('обычный режим сохраняет число колод подряд', () => {
  assert.equal(plannedGames({ mode: 'normal', games: 3 }), 3);
  assert.equal(plannedGames({ mode: 'normal', games: 0 }), 1);
  assert.equal(plannedGames({ mode: 'normal', games: '7' }), 7);
});

test('заданная колода и сухой прогон тоже делают одну попытку', () => {
  assert.equal(plannedGames({ deck: 'CODE', games: 10 }), 1);
  assert.equal(plannedGames({ mode: 'deck', games: 10 }), 1);
  assert.equal(plannedGames({ dryRun: true, games: 10 }), 1);
});

test('Runner в ежедневном режиме не перебирает колоды', async () => {
  const calls = { daily: 0, newGame: 0 };
  const game = {
    close: async () => {},
    startDailyGame: async () => {
      calls.daily += 1;
      return { date: '2026-11-26', deck: 'x'.repeat(104) };
    },
    startNewGame: async () => { calls.newGame += 1; },
    deckCode: async () => 'x'.repeat(104),
  };

  const runner = new Runner({ createGame: async () => game });
  runner.playOnce = async () => ({ ok: true });

  try {
    assert.equal(
      await runner.start({ mode: 'daily', games: 10, headless: true }),
      true,
    );
    assert.equal(runner.status.totalGames, 1);
    assert.equal(runner.status.gameNo, 1);
    assert.equal(calls.daily, 1);
    assert.equal(calls.newGame, 0);
  } finally {
    await runner.closeGame();
  }
});

test('Runner в обычном режиме по-прежнему перебирает колоды', async () => {
  let started = 0;
  const game = {
    close: async () => {},
    startNewGame: async () => { started += 1; },
    deckCode: async () => 'x'.repeat(104),
  };

  const runner = new Runner({ createGame: async () => game });
  runner.playOnce = async () => ({ ok: false });

  try {
    assert.equal(
      await runner.start({ mode: 'normal', games: 3, headless: true }),
      false,
    );
    assert.equal(runner.status.totalGames, 3);
    assert.equal(started, 3);
  } finally {
    await runner.closeGame();
  }
});

test('интерфейс скрывает «колод подряд» в ежедневном режиме', async () => {
  const html = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = await readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

  assert.match(html, /id="gamesField"/);
  assert.match(app, /\$\('gamesField'\)\.classList\.toggle\('hidden', mode === 'daily'\)/);
  assert.match(app, /games: \$\('mode'\)\.value === 'daily' \? 1 : Number\(\$\('games'\)\.value\)/);
});
