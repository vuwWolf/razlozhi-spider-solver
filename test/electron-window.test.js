import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('окно показывается, даже если ready-to-show опередил loadURL', async () => {
  const main = await readFile(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const ready = main.indexOf("once('ready-to-show'");
  const load = main.indexOf('await mainWindow.loadURL(origin)');

  assert.ok(ready !== -1, 'слушатель ready-to-show должен быть');
  assert.ok(load !== -1, 'загрузка страницы должна быть');
  assert.ok(ready < load, 'слушатель ready-to-show должен ставиться до loadURL');
  assert.match(main.slice(load), /showWindow\(\)/, 'нужен вызов showWindow после загрузки');
});
