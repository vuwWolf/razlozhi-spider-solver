import test from 'node:test';
import assert from 'node:assert/strict';
import { installHelpers } from '../src/page-helpers.js';

/** Минимальная копия механизма истории сайта. */
function setup() {
  class FakeGame {
    constructor() {
      this._history = [];
      this._lastHistoryTime = Date.now();
      this._freezed = { getValue: () => false };
    }

    start() {
      window.__spiderGame = this;
    }

    // Как в solitaires.js: playHistoryItem ставит _5z_ и ждёт _addLogRecord.
    playHistoryItem(item, callback, context) {
      if (this._freezed.getValue()) {
        callback.call(context, false);
        return;
      }
      this._5z_ = callback;
      this._60_ = context;
      this._addLogRecord(item);
    }

    _addLogRecord(record, time) {
      const now = Date.now();
      record.time = Math.min(63, Math.max(1, Math.round(
        ((time || now) - this._lastHistoryTime) / 100,
      )));
      this._history.push(record);
      this._lastHistoryTime = now;
    }
  }

  global.window = { Rzlzh: { Patiences: { Game: FakeGame } } };
  installHelpers();
  return FakeGame;
}

test('scripted-ход попадает в историю сайта — демка увидит все ходы', async () => {
  const FakeGame = setup();
  const game = new FakeGame();
  game.start();

  const ok = await window.__executeMove({ type: 'movecards', from: 2, to: 5, count: 3 });

  assert.equal(ok, true);
  assert.equal(game._history.length, 1);
  assert.equal(game._history[0].type, 'movecards');
  assert.equal(game._history[0].from, 2);
  assert.equal(game._history[0].to, 5);
  assert.equal(game._history[0].count, 3);
  assert.ok(game._history[0].time >= 1);
});

test('deal записывается в историю как deckclick', async () => {
  const FakeGame = setup();
  const game = new FakeGame();
  game.start();

  assert.equal(await window.__executeMove({ type: 'deal' }), true);
  assert.deepEqual(
    game._history.map((h) => h.type),
    ['deckclick'],
  );
});

test('обычные записи истории не дублируются, повторный installHelpers безопасен', () => {
  const FakeGame = setup();
  installHelpers();
  const game = new FakeGame();

  game._addLogRecord({ type: 'movecards', from: 0, to: 1, count: 1 });

  assert.equal(game._history.length, 1);
});

test('замороженная игра не оставляет ложный ход в истории', async () => {
  const FakeGame = setup();
  const game = new FakeGame();
  game.start();
  game._freezed = { getValue: () => true };

  assert.equal(await window.__executeMove({ type: 'deal' }), false);
  assert.equal(game._history.length, 0);
});
