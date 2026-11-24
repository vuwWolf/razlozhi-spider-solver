import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMoves } from '../src/model.js';
import { formatMoveLog, writeMoveLog } from '../src/report.js';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function makeFixture() {
  const state = {
    cols: Array.from({ length: 10 }, () => ({ down: [], up: [] })),
    stock: [],
    foundations: 0,
    moves: 0,
    deals: 0,
  };
  state.cols[0].up = [12]; // K♥
  const [move] = generateMoves(state);
  return { state, moves: [move, { type: 'deal' }] };
}

test('formatMoveLog нумерует ходы и описывает каждый из состояния до хода', () => {
  const { state, moves } = makeFixture();
  const text = formatMoveLog({
    moves,
    state,
    deckCode: 'DECK-CODE',
    attempt: 2,
  });

  assert.match(text, /^Решение пасьянса/);
  assert.match(text, /Колода: DECK-CODE/);
  assert.match(text, /Попытка поиска: 2/);
  assert.match(text, /Ходов: 2/);
  assert.match(text, /  1\. K♥ \(колонка 1\) → колонка 2/);
  assert.match(text, /  2\. раздать колоду/);
  assert.ok(text.endsWith('\n'));
});

test('formatMoveLog не меняет исходное состояние', () => {
  const { state, moves } = makeFixture();
  const before = JSON.stringify(state);
  formatMoveLog({ moves, state });
  assert.equal(JSON.stringify(state), before);
});

test('writeMoveLog создаёт каталоги и записывает файл в UTF-8', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spider-report-'));
  const file = join(dir, 'nested', 'solution.txt');
  const { state, moves } = makeFixture();

  try {
    const options = { moves, state, deckCode: 'DECK-CODE', date: FIXED_DATE };
    const saved = await writeMoveLog(file, options);
    assert.equal(saved.path, file);
    assert.equal(saved.moves, moves.length);

    const text = await readFile(file, 'utf8');
    assert.equal(text, formatMoveLog(options));
    assert.match(text, /Дата: 2026-01-01T00:00:00\.000Z/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
