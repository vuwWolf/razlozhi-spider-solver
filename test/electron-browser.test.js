import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddedSpiderGame } from '../src/electron-browser.js';

function fakeView() {
  return {
    webContents: {
      calls: [],
      executeJavaScript(code) {
        this.calls.push(code);
        return Promise.resolve(true);
      },
    },
  };
}

test('EmbeddedSpiderGame использует WebContentsView, не создаёт окно', async () => {
  const view = fakeView();
  const game = new EmbeddedSpiderGame(view, { profile: '/tmp/spider-profile' });

  assert.equal(game.webContents, view.webContents);
  assert.equal(game.profile, '/tmp/spider-profile');
  assert.equal(await game.eval('1 + 1'), true);
  assert.deepEqual(view.webContents.calls, ['1 + 1']);

  // Вид живёт в главном окне и переиспользуется между запусками.
  await game.close();
  assert.equal(view.webContents.calls.length, 1);
});

test('EmbeddedSpiderGame требует готовый WebContentsView', () => {
  assert.throws(
    () => new EmbeddedSpiderGame(null),
    /WebContentsView/,
  );
});
