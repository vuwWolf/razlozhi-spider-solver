#!/usr/bin/env node
/**
 * Локальный веб-интерфейс для автоматического прохождения Spider2.
 * По умолчанию слушает только 127.0.0.1 — интерфейс не доступен из сети.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Runner } from './runner.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const runner = new Runner();
const sseClients = new Set();

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(data);
}

runner.on('log', (line) => broadcast({ type: 'log', line }));
runner.on('status', (status) => broadcast({ type: 'status', status }));

function json(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16 * 1024) throw new Error('слишком большой запрос');
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('ожидался JSON');
  }
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'status', status: runner.getStatus() })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

async function handleStatic(res, pathname) {
  const file = STATIC_FILES[pathname];
  if (!file) return false;
  const [name, contentType] = file;
  try {
    const content = await readFile(path.join(PUBLIC_DIR, name));
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Файл не найден');
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/status') {
      return json(res, 200, runner.getStatus());
    }
    if (req.method === 'GET' && pathname === '/api/events') {
      return handleEvents(req, res);
    }

    if (req.method === 'POST' && pathname === '/api/start') {
      const body = await readBody(req);
      runner.start(body).catch(() => {}); // ошибки уже попадают в логи
      return json(res, 202, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/login') {
      runner.login().catch(() => {});
      return json(res, 202, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/confirm-login') {
      runner.confirmLogin('button');
      return json(res, 202, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/stop') {
      runner.stop();
      return json(res, 202, { ok: true });
    }

    if (req.method === 'GET' && await handleStatic(res, pathname)) return;

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 400, { error: err?.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[spider-web] http://${HOST}:${PORT}`);
});

async function shutdown() {
  runner.stop();
  await runner.closeGame();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
