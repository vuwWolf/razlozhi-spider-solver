/**
 * Копирует уже скачанные браузеры Playwright в build/playwright-browsers,
 * чтобы electron-builder упаковал их в приложение.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const source = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const destination = join(root, 'build', 'playwright-browsers');

const KEEP = /^(chromium|chromium_headless_shell|ffmpeg|winldd)-/;

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

try {
  const entries = await readdir(source, { withFileTypes: true });
  const selected = entries
    .filter((entry) => entry.isDirectory() && KEEP.test(entry.name))
    .map((entry) => entry.name);

  for (const name of selected) {
    await cp(join(source, name), join(destination, name), { recursive: true, force: true });
    console.log(`[playwright] ${name}`);
  }

  if (!selected.length) {
    console.warn('[playwright] браузеры не найдены — сначала выполните: npx playwright install chromium');
  }
} catch (err) {
  console.warn('[playwright] не удалось скопировать браузеры:', err?.message || String(err));
}
