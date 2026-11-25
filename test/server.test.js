import test from 'node:test';
import assert from 'node:assert/strict';
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
    assert.match(await pageRes.text(), /Паук \(две масти\)/);
  } finally {
    await handle.close();
  }
});
