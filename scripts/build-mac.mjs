/**
 * Точка входа для macOS-сборки.
 *
 * electron-builder отказывается собирать mac-приложения не на macOS, поэтому
 * проверяем платформу сразу — до скачивания браузеров — и даём понятную
 * подсказку. На macOS скрипт готовит браузеры и запускает сборку.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'darwin') {
  console.error('macOS-сборка возможна только на macOS (electron-builder не поддерживает кросс-сборку).');
  console.error('Запустите workflow "Build macOS" в GitHub Actions или выполните npm run dist:mac на Mac.');
  process.exit(1);
}

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} завершился с кодом ${code}`));
    });
  });
}

await run(path.join(ROOT, 'scripts', 'copy-playwright-mac.mjs'));
await run(
  path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'),
  ['--mac', '--universal', '--publish', 'never'],
);
