import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../src/server.js';

test('startServer поднимает локальный сервер и отдаёт статус и интерфейс', async () => {
  const handle = await startServer({ port: 0, host: '127.0.0.1' });

  try {
    assert.ok(handle.port > 0);

    const statusRes = await fetch(`http://127.0.0.1:${handle.port}/api/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.phase, 'idle');
    assert.equal(status.running, false);

    const pageRes = await fetch(`http://127.0.0.1:${handle.port}/`);
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();
    assert.match(html, /Паук \(две масти\)/);
    assert.match(html, /id="gameSlot"/);
  } finally {
    await handle.close();
  }
});

test('startServer принимает готовый Runner для встроенного драйвера', async () => {
  class FakeRunner extends EventEmitter {
    getStatus() {
      return { phase: 'idle', running: false, injected: true };
    }

    stop() {}

    closeGame() {
      return Promise.resolve();
    }
  }

  const runner = new FakeRunner();
  const handle = await startServer({ port: 0, host: '127.0.0.1', runner });

  try {
    assert.equal(handle.runner, runner);
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/status`);
    const status = await res.json();
    assert.equal(status.injected, true);
  } finally {
    await handle.close();
  }
});
