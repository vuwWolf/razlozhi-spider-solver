import {
  applyMove, evaluate, generateMoves, hashState, isWin,
} from './model.js';

const DEFAULT_OPTIONS = {
  width: 200,
  maxSteps: 1500,
  dealPenalty: 100,
  noise: 0,
  restarts: 3,
  stallLimit: 100000, // отключено: «пинок» мешает поиску выйти на решение
  timeLimitMs: 60000,
  maxVisited: 120000, // ограничение, чтобы не исчерпать кучу V8
  scorer: evaluate,
};

/**
 * Поиск лучших позиций по оценке (beam search).
 *
 * Возвращает { moves, nodes, elapsedMs, foundations } или null.
 */
export function beamSolve(state, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startedAt = Date.now();
  const root = { state, parent: null, move: null, depth: 0 };
  let beam = [root];
  const visited = new Set([hashState(state)]);
  let best = root;
  let bestScore = opts.scorer(state);
  let stalled = 0;
  let nodes = 0;

  for (let step = 0; step < opts.maxSteps; step++) {
    if (Date.now() - startedAt > opts.timeLimitMs || opts.shouldStop?.()) break;
    if (step % 20 === 0) {
      opts.onProgress?.({ type: 'search', step, nodes, foundations: best.state.foundations });
    }

    const candidates = [];
    let timedOut = false;
    for (const node of beam) {
      // Один шаг beam может быть дорогим: проверяем дедлайн и внутри него,
      // иначе лимит времени легко превышается в несколько раз.
      if (Date.now() - startedAt > opts.timeLimitMs || opts.shouldStop?.()) {
        timedOut = true;
        break;
      }
      for (const move of generateMoves(node.state)) {
        const next = applyMove(node.state, move);
        const hash = hashState(next);
        if (visited.has(hash)) continue;
        if (visited.size >= opts.maxVisited) {
          visited.clear();
          visited.add(hashState(best.state));
        }
        visited.add(hash);
        nodes++;

        const child = { state: next, parent: node, move, depth: node.depth + 1 };
        if (isWin(next)) {
          child.score = evaluate(next);
          return buildResult(child, nodes, startedAt);
        }
        child.score = opts.scorer(next, opts.noise) - opts.dealPenalty * next.deals;
        candidates.push(child);
      }
    }
    if (timedOut || !candidates.length) break;

    candidates.sort((a, b) => b.score - a.score);
    beam = candidates.slice(0, opts.width);

    if (beam[0].score > bestScore) {
      bestScore = beam[0].score;
      best = beam[0];
      stalled = 0;
    } else {
      stalled++;
    }

    if (stalled >= opts.stallLimit) {
      // «Пинок»: продолжаем из лучшей позиции с добавлением шума.
      beam = [best];
      visited.clear();
      visited.add(hashState(best.state));
      stalled = 0;
    }
  }

  return buildResult(best, nodes, startedAt, false);
}

function buildResult(node, nodes, startedAt, won = true) {
  const moves = [];
  let current = node;
  while (current && current.move) {
    moves.push(current.move);
    current = current.parent;
  }
  moves.reverse();
  return {
    moves,
    nodes,
    elapsedMs: Date.now() - startedAt,
    foundations: node.state.foundations,
    won,
  };
}

/**
 * Несколько попыток с разными настройками.
 *
 * Опытным путём установлено: на разных колодах лучшая задержка раздачи
 * (`dealPenalty`) сильно различается. Поэтому попытки перебирают несколько
 * её значений — это эффективнее, чем просто добавлять шум к эвристике.
 */
export function solveWithRestarts(state, options = {}) {
  const attempts = options.restarts ?? 8;
  const penalties = [100, 200, 1000, 2000, 5000, 50, 500, 300];
  // Небольшой шум на части попыток добавляет разнообразия в beam: на некоторых
  // колодах детерминированный поиск застревает на 6 собранных мастях.
  const noises = [0, 0, 500, 0, 0, 200, 500, 1000];
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.shouldStop?.()) return null;
    options.onProgress?.({ type: 'attempt', attempt: attempt + 1, attempts });
    const result = beamSolve(state, {
      ...options,
      dealPenalty: penalties[attempt % penalties.length],
      noise: options.noise ?? noises[attempt % noises.length],
    });
    if (result.won) return { ...result, attempt: attempt + 1 };
  }
  return null;
}

/** Обратная совместимость: жадный поиск с возвратом. */
export function solve(state, options = {}) {
  return beamSolve(state, options);
}
