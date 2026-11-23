import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABC, decodeDeck, createState, fromSnapshot, generateMoves, applyMove,
  isWin, rankOf, suitOf, cardName, fromSiteCard, toSiteCard, normalize, runs,
  evaluate,
} from '../src/model.js';

const DECK = '7j6qjhzx97hs7zlxqpyh93n85418xtqrtskn3j0p8ol643mrim2q4jsyyo1zxpn6io27519i0m9r2ntzt0iy85kk4l5p32o0skmhr16l';

test('декодирование колоды sites → внутренний формат', () => {
  // '7' = индекс 59 = (3<<4)|11 → пики, номинал 11 (J)
  assert.equal(ABC.indexOf('7'), 59);
  assert.equal(decodeDeck('7')[0], 1 * 13 + 11 - 1);
  assert.equal(cardName(decodeDeck('7')[0]), 'J♠');
  // 'x' = индекс 49 = (3<<4)|1 → пики, туз
  assert.equal(cardName(decodeDeck('x')[0]), 'A♠');
  // 'o' = индекс 40 = (2<<4)|8 → черви, 8
  assert.equal(cardName(decodeDeck('o')[0]), '8♥');
});

test('начальное состояние совпадает с игрой', () => {
  const s = createState(DECK);
  assert.equal(s.stock.length, 50);
  assert.deepEqual(
    s.cols.map((c) => [c.down.length, c.up.length]),
    [[5, 1], [5, 1], [5, 1], [5, 1], [4, 1], [4, 1], [4, 1], [4, 1], [4, 1], [4, 1]],
  );
  assert.equal(s.cols[0].up[0], 2); // 3♥ → suit=0, rank=3
  assert.equal(cardName(s.cols[0].up[0]), '3♥');
  assert.equal(cardName(s.cols[9].up[0]), 'Q♥');
});

test('преобразование форматов карт', () => {
  assert.equal(fromSiteCard(3, 1), 0);  // A♥
  assert.equal(fromSiteCard(4, 13), 25); // K♠
  assert.deepEqual(toSiteCard(0), { suit: 3, nominal: 1 });
  assert.deepEqual(toSiteCard(25), { suit: 4, nominal: 13 });
});

test('перетаскивание только целого одномастного хвоста', () => {
  const s = {
    cols: Array.from({ length: 10 }, () => ({ down: [], up: [] })),
    stock: [], foundations: 0, moves: 0, deals: 0,
  };
  // 9♥ 8♥ 7♠: можно двигать только 7♠ и (9♥ 8♥)? нет — хвост от 9♥ содержит 7♠
  s.cols[0].up = [8, 7, 19]; // 9♥, 8♥, 7♠  (suit0: 8=9♥,7=8♥; suit1: 19=7♠)
  s.cols[1].up = [9]; // 10♥
  const moves = generateMoves(s);
  // из колонки 0 доступен только хвост [19] (7♠), он может лечь на 8♥ (nominal 8) — нет
  // проверим, что нет хода с count=2 или 3 из колонки 0
  const from0 = moves.filter((m) => m.from === 0);
  assert.ok(from0.every((m) => m.count === 1));
});

test('разная масть разрывает последовательность (A♠ K♥ не хвост)', () => {
  const s = {
    cols: Array.from({ length: 10 }, () => ({ down: [], up: [] })),
    stock: [], foundations: 0, moves: 0, deals: 0,
  };
  s.cols[0].up = [13, 12, 11]; // A♠, K♥, Q♥ — НЕ одномастная убывающая серия
  const from0 = generateMoves(s).filter((m) => m.from === 0);
  assert.ok(
    from0.every((m) => m.count <= 2),
    'нельзя тащить A♠ вместе с K♥ Q♥ (но K♥ Q♥ — корректная серия)',
  );
  assert.deepEqual(runs(s.cols[0].up), [[12, 11]]);
});

test('нормализация убирает готовую последовательность K..A', () => {
  const s = {
    cols: Array.from({ length: 10 }, () => ({ down: [], up: [] })),
    stock: [], foundations: 0, moves: 0, deals: 0,
  };
  s.cols[0].up = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; // K♥..A♥
  s.cols[1].down = [25];
  normalize(s);
  assert.equal(s.foundations, 1);
  assert.equal(s.cols[0].up.length, 0);
  assert.equal(s.cols[1].up.length, 1); // карта перевернулась
});

test('раздача и победа', () => {
  const s = {
    cols: Array.from({ length: 10 }, () => ({ down: [0], up: [] })),
    stock: Array.from({ length: 50 }, (_, i) => i),
    foundations: 7, moves: 0, deals: 0,
  };
  const move = generateMoves(s).find((m) => m.type === 'deal');
  assert.ok(move);
  const ns = applyMove(s, move);
  assert.equal(ns.stock.length, 40);
  assert.equal(ns.deals, 1);
});

test('ранг и масть', () => {
  assert.equal(rankOf(0), 1);
  assert.equal(rankOf(12), 13);
  assert.equal(rankOf(13), 1);
  assert.equal(suitOf(12), 0);
  assert.equal(suitOf(13), 1);
});

test('эвристика ценит открытого короля выше туза', () => {
  // Открытая карта с высоким достоинством — хорошая подставка:
  // на короля можно положить даму, на туза — ничего.
  const make = (top) => ({
    cols: [
      { down: [], up: [top] },
      ...Array.from({ length: 9 }, () => ({ down: [], up: [] })),
    ],
    stock: [], foundations: 0, moves: 0, deals: 0,
  });
  assert.ok(evaluate(make(12)) > evaluate(make(0))); // K♥ > A♥
});
