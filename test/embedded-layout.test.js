import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readPublic = (name) => readFile(path.join(ROOT, 'public', name), 'utf8');

test('встроенная игра не привязана к скроллу страницы', async () => {
  const app = await readPublic('app.js');
  assert.doesNotMatch(app, /addEventListener\(['"]scroll['"]/);
});

test('десктопная раскладка прокручивает только панель управления', async () => {
  const html = await readPublic('index.html');
  const css = await readPublic('style.css');

  assert.match(html, /<div class="control-column">/);
  assert.match(css, /body\.desktop-embedded\s*\{\s*overflow:\s*hidden;/);
  assert.match(css, /body\.desktop-embedded \.control-column\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /body\.desktop-embedded \.game-panel\s*\{[^}]*grid-column:\s*2/s);
});
