/**
 * Клиент поискового воркера для Runner (веб и десктоп).
 *
 * Воркер живёт всё время работы сервера и переиспользуется между колодами.
 * Остановка поиска — запись флага в SharedArrayBuffer: воркер проверяет его
 * прямо внутри цикла beam search, не дожидаясь событийного цикла.
 */
import { Worker } from 'node:worker_threads';

let worker = null;
let stopBuffer = null;
let pending = null;
let nextId = 1;

function ensureWorker() {
  if (worker) return worker;

  stopBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  worker = new Worker(new URL('./solver-worker.js', import.meta.url), {
    workerData: { stopBuffer },
  });
  // Сам по себе воркер не должен удерживать процесс от выхода.
  worker.unref();

  worker.on('message', (msg) => {
    if (!pending || msg.id !== pending.id) return;
    if (msg.type === 'progress') {
      pending.onProgress?.(msg);
      return;
    }
    const job = pending;
    pending = null;
    if (msg.type === 'error') job.reject(new Error(msg.message));
    else job.resolve(msg.result);
  });

  worker.on('error', (err) => {
    const job = pending;
    pending = null;
    job?.reject(err);
    worker = null;
  });

  worker.on('exit', () => {
    if (pending) {
      const job = pending;
      pending = null;
      job.reject(new Error('процесс поиска завершился'));
    }
    worker = null;
  });

  return worker;
}

/** Запустить поиск; onProgress вызывается не чаще одного раза в 250 мс. */
export function solveInWorker(state, options = {}, onProgress = null) {
  if (pending) throw new Error('поиск решения уже идёт');
  const thread = ensureWorker();
  Atomics.store(new Int32Array(stopBuffer), 0, 0);

  // В сообщение нельзя положить функции (shouldStop, onProgress) — они
  // создаются внутри воркера. Передаём только числовые настройки поиска.
  const { restarts, maxSteps, timeLimitMs, width, maxVisited, noise } = options;
  const jobOptions = { restarts, maxSteps, timeLimitMs, width, maxVisited, noise };
  for (const key of Object.keys(jobOptions)) {
    if (jobOptions[key] === undefined) delete jobOptions[key];
  }

  const id = nextId++;
  let lastProgressAt = 0;
  return new Promise((resolve, reject) => {
    pending = {
      id,
      resolve,
      reject,
      onProgress: onProgress
        ? (msg) => {
          if (msg.kind === 'search' && Date.now() - lastProgressAt < 250) return;
          lastProgressAt = Date.now();
          onProgress(msg);
        }
        : null,
    };
    thread.postMessage({ id, state, options: jobOptions });
  });
}

/** Прервать текущий поиск (проверяется воркером на каждом шаге). */
export function stopSolver() {
  if (!stopBuffer) return;
  Atomics.store(new Int32Array(stopBuffer), 0, 1);
}

/** Завершить воркер, например при закрытии сервера. */
export async function closeSolver() {
  stopSolver();
  if (pending) {
    const job = pending;
    pending = null;
    job.resolve(null);
  }
  const thread = worker;
  worker = null;
  stopBuffer = null;
  if (thread) await thread.terminate();
}
