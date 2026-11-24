import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('electron-builder настроен для Windows и macOS', async () => {
  const config = JSON.parse(
    await readFile(path.join(ROOT, 'electron-builder.json'), 'utf8'),
  );

  assert.deepEqual(config.win.target, ['nsis']);
  assert.deepEqual(
    config.win.extraResources.map((resource) => resource.from),
    ['build/playwright-browsers'],
  );

  assert.deepEqual(config.mac.target, ['dmg', 'zip']);
  assert.match(config.mac.artifactName, /\$\{arch\}/);
  assert.deepEqual(
    config.mac.extraResources.map((resource) => resource.to),
    ['playwright-browsers'],
  );
  assert.deepEqual(
    config.mac.extraResources.map((resource) => resource.from),
    ['build/playwright-browsers-mac'],
  );
});

test('GitHub Actions собирает macOS на macOS-раннере', async () => {
  const workflow = await readFile(
    path.join(ROOT, '.github', 'workflows', 'build-macos.yml'),
    'utf8',
  );

  assert.match(workflow, /runs-on: macos-/);
  assert.match(workflow, /npm run dist:mac/);
  assert.match(workflow, /path: dist\/\*\.dmg/);
  assert.match(workflow, /path: dist\/\*\.zip/);
});
