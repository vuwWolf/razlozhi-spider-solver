/**
 * Готовит браузеры Playwright для macOS-сборки.
 *
 * Обычный `playwright install chromium` не работает на Windows: внутри .app
 * есть symlink-ы, а без прав разработчика Windows их создати нельзя. Поэтому
 * узнаём URL через `playwright install --dry-run` с подменой платформы,
 * скачиваем архивы сами и распаковываем их, заменяя symlink-ы копиями.
 *
 * Для Intel и Apple Silicon каталоги объединяются в build/playwright-browsers-mac.
 * electron-builder кладёт их в Resources/playwright-browsers, а main.js выставляет
 * PLAYWRIGHT_BROWSERS_PATH до загрузки playwright. Получается universal-набор:
 * внутри chromium-1255 лежат и chrome-mac-x64, и chrome-mac-arm64.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import {
  cp, mkdir, readdir, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import * as unzipper from 'unzipper';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'node_modules', 'playwright', 'cli.js');
const BUILD_DIR = path.join(ROOT, 'build');
const CACHE_DIR = path.join(BUILD_DIR, '.playwright-mac-cache');
const DESTINATION = path.join(BUILD_DIR, 'playwright-browsers-mac');

const TARGETS = [
  { host: 'mac15-arm64', arch: 'arm64', label: 'Apple Silicon' },
  { host: 'mac15', arch: 'x64', label: 'Intel' },
];

function runDryRun(host) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'install', 'chromium', '--dry-run'], {
      cwd: ROOT,
      env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: host },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`playwright --dry-run завершился с кодом ${code} (${host})`));
    });
  });
}

/** Достаём из dry-run пары «имя каталога → URL архива». */
function parseDownloads(output) {
  const result = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    let match = line.match(/Install location:\s+(.+?)\s*$/);
    if (match) {
      if (current) result.push(current);
      current = { name: path.basename(match[1].trim()), url: null };
      continue;
    }
    match = line.match(/Download url:\s+(\S+)/);
    if (match && current && !current.url) current.url = match[1];
  }
  if (current) result.push(current);

  return result.filter((item) => item.url);
}

async function download(url, file) {
  if (existsSync(file)) {
    console.log(`[playwright] кэш: ${path.basename(file)}`);
    return;
  }
  console.log(`[playwright] скачиваем ${path.basename(file)}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

/**
 * Распаковываем zip. Symlink-ы не материализуем (Windows не может их создать):
 * записываем их в манифест, а приложение восстановит их на macOS при старте.
 */
async function extractZip(zipPath, targetDir) {
  const archive = await unzipper.Open.file(zipPath);
  const root = path.resolve(targetDir);
  const links = [];
  await mkdir(root, { recursive: true });

  for (const entry of archive.files) {
    const relative = entry.path.replace(/\\/g, '/');
    const out = path.resolve(root, relative);
    if (out !== root && !out.startsWith(root + path.sep)) continue;

    const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const isSymlink = (mode & 0xf000) === 0xa000;

    if (isSymlink) {
      links.push({
        link: relative,
        target: (await entry.buffer()).toString('utf8').replace(/\\/g, '/'),
      });
      continue;
    }
    if (entry.type === 'Directory' || relative.endsWith('/')) {
      await mkdir(out, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, await entry.buffer());
  }

  return links;
}

await mkdir(CACHE_DIR, { recursive: true });
await rm(DESTINATION, { recursive: true, force: true });
await mkdir(DESTINATION, { recursive: true });

const symlinks = [];

for (const target of TARGETS) {
  console.log(`[playwright] браузеры для macOS (${target.label})`);
  const downloads = parseDownloads(await runDryRun(target.host));

  for (const item of downloads) {
    const archive = path.join(CACHE_DIR, `${item.name}-${target.arch}.zip`);
    await download(item.url, archive);

    const temp = path.join(BUILD_DIR, `.extract-${item.name}-${target.arch}`);
    await rm(temp, { recursive: true, force: true });
    const links = await extractZip(archive, temp);
    for (const link of links) {
      symlinks.push({ link: `${item.name}/${link.link}`, target: link.target });
    }
    const installedDir = path.join(DESTINATION, item.name);
    await cp(temp, installedDir, { recursive: true, force: true });
    await writeFile(path.join(installedDir, 'INSTALLATION_COMPLETE'), '');
    await rm(temp, { recursive: true, force: true });
  }
}

await writeFile(
  path.join(DESTINATION, 'symlinks.json'),
  `${JSON.stringify(symlinks, null, 2)}\n`,
);

const installed = (await readdir(DESTINATION)).filter((name) =>
  /^(chromium|chromium_headless_shell|ffmpeg)-/.test(name),
);
console.log(`[playwright] готово: ${installed.join(', ')} (symlink-ов: ${symlinks.length})`);
