/**
 * Чистая модель пасьянса «Паук (две масти)».
 *
 * Карта кодируется целым числом 0..25:
 *   0..12  — черви (A..K)
 *   13..25 — пики (A..K)
 * Номер карты: `suit * 13 + (rank - 1)`.
 */

export const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-';
export const HEARTS = 0;
export const SPADES = 1;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const rankOf = (card) => (card % 13) + 1;
export const suitOf = (card) => Math.floor(card / 13);

/** Перевод карты сайта (масть 3 — черви, 4 — пики) во внутренний формат. */
export const fromSiteCard = (suit, nominal) => (suit - 3) * 13 + nominal - 1;

/** Перевод внутренней карты в формат сайта. */
export const toSiteCard = (card) => ({
  suit: suitOf(card) + 3,
  nominal: rankOf(card),
});

export function cardName(card) {
  return `${RANKS[rankOf(card) - 1]}${suitOf(card) === HEARTS ? '♥' : '♠'}`;
}

/**
 * Декодирует строку колоды razlozhi.ru в массив карт.
 *
 * Формат сайта: `index = (suit - 1) << 4 | nominal`, где suit=3 (черви)
 * или suit=4 (пики), nominal=1..13. Внутренний формат: `suit * 13 + rank - 1`.
 */
export function decodeDeck(code) {
  return Array.from(code, (ch) => {
    const index = ABC.indexOf(ch);
    if (index < 0) throw new Error(`Неизвестный символ колоды: ${ch}`);
    return ((index >> 4) - 2) * 13 + (index & 15) - 1;
  });
}

/**
 * Строит начальное состояние по строке колоды.
 *
 * Сайт раздаёт 54 карты по правилу `index % 10`, верхние 10 (index >= 44)
 * сразу переворачиваются лицом вверх. Остальные 50 карт остаются в колоде;
 * каждая раздача берёт по одной карте с «верха» колоды (конца массива).
 */
export function createState(deckCode) {
  const cards = decodeDeck(deckCode);
  if (cards.length !== 104) throw new Error('Колода должна содержать 104 карты');

  const cols = Array.from({ length: 10 }, () => ({ down: [], up: [] }));
  for (let i = 0; i < 54; i++) {
    const card = cards[cards.length - 1 - i];
    const col = cols[i % 10];
    if (i >= 44) col.up.push(card);
    else col.down.push(card);
  }

  return normalize({
    cols,
    stock: cards.slice(0, 50), // верхушка — конец массива
    foundations: 0,
    moves: 0,
    deals: 0,
  });
}

/** Строит состояние из уже разложенной игры (для продолжения). */
export function fromSnapshot(snapshot) {
  return normalize({
    cols: snapshot.cols.map((col) => ({
      down: col.down.slice(),
      up: col.up.slice(),
    })),
    stock: snapshot.stock.slice(),
    foundations: snapshot.foundations | 0,
    moves: snapshot.moves | 0,
    deals: snapshot.deals | 0,
  });
}

function cloneState(state) {
  return {
    cols: state.cols.map((col) => ({
      down: col.down.slice(),
      up: col.up.slice(),
    })),
    stock: state.stock.slice(),
    foundations: state.foundations,
    moves: state.moves,
    deals: state.deals,
  };
}

/** Переворачивает открывшиеся карты и убирает готовые sequences K..A. */
export function normalize(state) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const col of state.cols) {
      if (col.up.length === 0 && col.down.length > 0) {
        col.up.push(col.down.pop());
        changed = true;
      }
      if (col.up.length >= 13) {
        const tail = col.up.slice(-13);
        const suit = suitOf(tail[0]);
        const complete =
          tail[0] === suit * 13 + 12 &&
          tail.every((card, i) => card === suit * 13 + (12 - i));
        if (complete) {
          col.up.length -= 13;
          state.foundations++;
          changed = true;
        }
      }
    }
  }
  return state;
}

/**
 * Индексы карт, с которых можно начать перетаскивание.
 * Сайт разрешает взять карту вместе со ВСЕМИ лежащими ниже, только если
 * весь этот «хвост» — убывающая последовательность одной масти.
 */
function draggableIndices(up) {
  const result = [];
  for (let k = 0; k < up.length; k++) {
    let ok = true;
    for (let i = k; i < up.length; i++) {
      if (i > k && (suitOf(up[i]) !== suitOf(up[i - 1]) || up[i] !== up[i - 1] - 1)) {
        ok = false;
        break;
      }
    }
    if (ok) result.push(k);
  }
  return result;
}

/** Все легальные ходы: перекладывание последовательности и раздача колоды. */
export function generateMoves(state) {
  const moves = [];

  for (let from = 0; from < 10; from++) {
    const src = state.cols[from];
    if (src.up.length === 0) continue;

    for (const k of draggableIndices(src.up)) {
      const count = src.up.length - k;
      const first = src.up[k];
      for (let to = 0; to < 10; to++) {
        if (to === from) continue;
        const dst = state.cols[to];
        if (dst.up.length === 0) {
          moves.push({ type: 'move', from, k, count, to });
        } else if (rankOf(first) === rankOf(dst.up[dst.up.length - 1]) - 1) {
          moves.push({ type: 'move', from, k, count, to });
        }
      }
    }
  }

  if (
    state.stock.length > 0 &&
    state.cols.every((col) => col.down.length > 0 || col.up.length > 0)
  ) {
    moves.push({ type: 'deal' });
  }

  return moves;
}

export function applyMove(state, move) {
  const next = cloneState(state);

  if (move.type === 'deal') {
    for (const col of next.cols) {
      const card = next.stock.pop();
      if (card !== undefined) col.up.push(card);
    }
    next.deals++;
  } else {
    const src = next.cols[move.from];
    const dst = next.cols[move.to];
    const moved = src.up.splice(move.k, move.count);
    dst.up.push(...moved);
  }

  next.moves++;
  return normalize(next);
}

export function isWin(state) {
  return (
    state.foundations === 8 &&
    state.stock.length === 0 &&
    state.cols.every((col) => col.down.length === 0 && col.up.length === 0)
  );
}

export function hashState(state) {
  const cols = state.cols.map((col) => `${col.down.join(',')}|${col.up.join(',')}`).join(';');
  return `${cols}#${state.stock.length}#${state.foundations}`;
}

/** Возвращает максимальные убывающие последовательности одной масти в `up`. */
export function runs(up) {
  const result = [];
  let current = [];
  for (const card of up) {
    if (current.length && suitOf(card) === suitOf(current[current.length - 1])
        && card === current[current.length - 1] - 1) {
      current.push(card);
    } else {
      if (current.length > 1) result.push(current);
      current = [card];
    }
  }
  if (current.length > 1) result.push(current);
  return result;
}

/**
 * Эвристика: чем выше значение, тем «лучше» позиция.
 *
 * Веса подобраны экспериментально: решающее значение имеют
 * одномастные серии (runBonus) — именно они превращаются в K→A.
 */
export function evaluate(state, noise = 0) {
  let score = 1000000 * state.foundations;

  const hidden = state.cols.reduce((sum, col) => sum + col.down.length, 0);
  const empty = state.cols.filter((col) => col.down.length === 0 && col.up.length === 0).length;
  score -= 300 * hidden;
  score += 120 * empty;

  let samePairs = 0;
  let runBonus = 0;
  for (const col of state.cols) {
    for (const run of runs(col.up)) {
      samePairs += run.length - 1;
      runBonus += (run.length - 1) ** 2;
      if (rankOf(run[0]) === 13) runBonus += 25; // король — хорошее начало
    }
    if (col.up.length > 0) {
      // Открытая карта высокого достоинства — хорошая «подставка»:
      // на неё можно положить карту на единицу меньше. Карта A — бесполезна.
      score += 0.5 * rankOf(col.up[col.up.length - 1]);
    }
  }
  score += 12 * samePairs + 80 * runBonus;
  score -= 0.5 * state.moves;

  return noise ? score + (Math.random() - 0.5) * noise : score;
}

export function describeMove(move, state) {
  if (move.type === 'deal') return 'раздать колоду';
  const card = state.cols[move.from].up[move.k];
  return `${cardName(card)} (колонка ${move.from + 1}) → колонка ${move.to + 1}`;
}
