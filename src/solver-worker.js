/**
 * Поиск решения в отдельном потоке.
 *
 * beam search — CPU-задача на десятки секунд. В основном процессе она
 * блокирует событийный цикл Electron: интерфейс не обновляется, а кнопка
 * «Стоп» не отвечает. Здесь поиск изолирован, а остановка передаётся через
 * SharedArrayBuffer — обычное сообщение worker не смог бы принять, пока
 * занят вычислениями.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { solveWithRestarts } from './solver.js';

const stopFlag = new Int32Array(workerData.stopBuffer);
let currentAttempt = 0;

parentPort.on('message', ({ id, state, options }) => {
  Atomics.store(stopFlag, 0, 0);
  currentAttempt = 0;

  const onProgress = (progress) => {
    if (progress.type === 'attempt') currentAttempt = progress.attempt;
    parentPort.postMessage({
      ...progress, kind: progress.type, type: 'progress', id,
      attempt: progress.attempt || currentAttempt,
    });
  };

  try {
    const result = solveWithRestarts(state, {
      ...options,
      shouldStop: () => Atomics.load(stopFlag, 0) === 1,
      onProgress,
    });
    parentPort.postMessage({ type: 'result', id, result });
  } catch (err) {
    parentPort.postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
});
