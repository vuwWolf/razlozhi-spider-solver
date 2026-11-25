import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('electron-builder не упаковывает браузеры Playwright в десктоп', async () => {
  const config = JSON.parse(
    await readFile(path.join(ROOT, 'electron-builder.json'), 'utf8'),
  );

  assert.deepEqual(config.win.target, ['nsis']);
  assert.deepEqual(config.win.extraResources, undefined);
  assert.deepEqual(config.mac.target, ['dmg', 'zip']);
  assert.match(config.mac.artifactName, /\$\{arch\}/);
  assert.deepEqual(config.mac.extraResources, undefined);
});

test('npm-скрипты собирают arm64 и x64 отдельно', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['dist:mac:arm64'], 'node scripts/build-mac.mjs arm64');
  assert.equal(pkg.scripts['dist:mac:x64'], 'node scripts/build-mac.mjs x64');
  assert.equal(pkg.scripts['dist:mac'], 'node scripts/build-mac.mjs all');
  assert.equal(pkg.scripts.predist, undefined);
  assert.equal(pkg.scripts['prepare:mac-browsers'], undefined);
  assert.equal(pkg.scripts['prepare:mac-browsers:arm64'], undefined);
  assert.equal(pkg.scripts['prepare:mac-browsers:x64'], undefined);

  // CLI и веб по-прежнему используют Playwright, но он не нужен внутри приложения.
  assert.match(pkg.devDependencies.playwright, /^\^/);
  assert.equal(pkg.dependencies, undefined);
});

test('GitHub Actions собирает macOS по отдельным архитектурам', async () => {
  const workflow = await readFile(
    path.join(ROOT, '.github', 'workflows', 'build-macos.yml'),
    'utf8',
  );

  assert.match(workflow, /runs-on: macos-/);
  assert.match(workflow, /arch: \[arm64, x64\]/);
  assert.match(workflow, /npm run dist:mac:\$\{\{ matrix\.arch \}\}/);
  assert.match(workflow, /name: Spider-Solver-macos-\$\{\{ matrix\.arch \}\}-dmg/);
  assert.match(workflow, /name: Spider-Solver-macos-\$\{\{ matrix\.arch \}\}-zip/);
  assert.match(workflow, /path: dist\/\*-\$\{\{ matrix\.arch \}\}\.dmg/);
  assert.match(workflow, /path: dist\/\*-\$\{\{ matrix\.arch \}\}\.zip/);
});
