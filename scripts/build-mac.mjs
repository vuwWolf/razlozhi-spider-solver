/**
 * Точка входа для macOS-сборки.
 *
 * electron-builder отказывается собирать mac-приложения не на macOS, поэтому
 * проверяем платформу сразу — до скачивания браузеров — и даём понятную
 * подсказку. Архитектура выбирается аргументом: arm64, x64 или all (по умолчанию).
 * Для каждой архитектуры отдельно готовятся браузеры и вызывается electron-builder,
 * поэтому в dist/ получаются отдельные пакеты с нужным набором Chromium.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2] || 'all';
const ARCHES = requested === 'all' ? ['arm64', 'x64'] : [requested];

if (!ARCHES.every((arch) => ['arm64', 'x64'].includes(arch))) {
  console.error(`Неизвестная архитектура: ${requested}. Используйте arm64, x64 или all.`);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.error('macOS-сборка возможна только на macOS (electron-builder не поддерживает кросс-сборку).');
  console.error('Запустите workflow "Build macOS" в GitHub Actions или выполните npm run dist:mac:arm64 / dist:mac:x64 на Mac.');
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

const prepare = path.join(ROOT, 'scripts', 'copy-playwright-mac.mjs');
const builder = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');

for (const arch of ARCHES) {
  console.log(`[mac] сборка для ${arch}`);
  await run(prepare, [`--arch=${arch}`]);
  await run(builder, ['--mac', `--${arch}`, '--publish', 'never']);
}
