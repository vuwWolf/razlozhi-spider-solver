/**
 * Electron-обёртка над локальным веб-интерфейсом.
 *
 * В main-процессе поднимается тот же сервер, что и у `npm run web`, но на
 * свободном порту. Окно просто открывает его по localhost — frontend и Runner
 * остаются полностью переиспользованными.
 */
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } from 'electron';
import {
  mkdirSync, existsSync, chmodSync, lstatSync, readdirSync, readFileSync, statSync, symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let tray = null;
let serverHandle = null;
let cleanupDone = false;
let isQuitting = false;

/**
 * Windows не умеет создавать symlinks из mac-архивов без прав разработчика.
 * Поэтому при распаковке мы сохранили их список, а здесь восстанавливаем.
 */
function restoreSymlinks(directory) {
  if (process.platform !== 'darwin') return;
  const manifest = path.join(directory, 'symlinks.json');
  if (!existsSync(manifest)) return;

  let links;
  try {
    links = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return;
  }

  for (const { link, target } of links) {
    try {
      const full = path.join(directory, link);
      if (lstatSync(full, { throwIfNoEntry: false })) continue;
      mkdirSync(path.dirname(full), { recursive: true });
      symlinkSync(target, full);
    } catch {
      // Если восстановить не удалось, Playwright сообщит об ошибке подробнее.
    }
  }
}

/**
 * Сборка может идти на Windows, где у mac-бинарников теряется бит +x.
 * На macOS перед запуском Playwright восстанавливаем его.
 */
function restoreExecutableBits(directory) {
  if (process.platform !== 'darwin') return;

  const visit = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) {
          const mode = statSync(full).mode;
          if (!(mode & 0o111)) chmodSync(full, mode | 0o111);
        }
      } catch {
        // Недоступный файл не должен мешать запуску приложения.
      }
    }
  };

  visit(directory);
}

function configureEnvironment() {
  // В собранном приложении браузеры Playwright лежат в resources,
  // а не в системном кэше — добавляем их до загрузки playwright.
  if (app.isPackaged) {
    const browsers = path.join(process.resourcesPath, 'playwright-browsers');
    if (existsSync(browsers)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
      restoreSymlinks(browsers);
      restoreExecutableBits(browsers);
    }
  }

  // Свой профиль, чтобы десктоп не конфликтовал с CLI/веб-версией.
  const profile = path.join(app.getPath('userData'), 'browser-profile');
  process.env.SPIDER_PROFILE_DIR = profile;
  mkdirSync(profile, { recursive: true });
  return profile;
}

function setupIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    profile: process.env.SPIDER_PROFILE_DIR || null,
    packaged: app.isPackaged,
  }));

  ipcMain.handle('app:open-profile', async () => {
    const profile = process.env.SPIDER_PROFILE_DIR;
    if (!profile) return false;
    mkdirSync(profile, { recursive: true });
    await shell.openPath(profile);
    return true;
  });

  ipcMain.handle('app:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

function setupMenu() {
  const template = [
    {
      label: 'Приложение',
      submenu: [
        {
          label: 'Открыть папку профиля',
          click: async () => {
            const profile = process.env.SPIDER_PROFILE_DIR;
            if (profile) await shell.openPath(profile);
          },
        },
        {
          label: 'Открыть сайт',
          click: async () => shell.openExternal('https://razlozhi.ru/patience-spider2'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    { role: 'viewMenu', label: 'Вид' },
    {
      role: 'help',
      label: 'Справка',
      submenu: [{
        label: 'О программе',
        click: () => dialog.showMessageBox({
          type: 'info',
          title: 'Spider Solver',
          message: `Spider Solver ${app.getVersion()}`,
          detail: 'Автоматическое прохождение «Паука (две масти)» на razlozhi.ru.',
        }),
      }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setupTray() {
  try {
    const icon = await app.getFileIcon(process.execPath);
    tray = new Tray(icon);
    tray.setToolTip('Spider Solver');
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Показать окно',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { label: 'Выход', click: () => app.quit() },
    ]));
    tray.on('double-click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch {
    // Трей — удобство, а не критичная часть: при ошибке просто работаем без него.
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 900,
    minHeight: 700,
    title: 'Spider Solver',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: path.join(ELECTRON_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const origin = `http://127.0.0.1:${serverHandle.port}`;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(origin);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
}

async function bootstrap() {
  configureEnvironment();
  setupIpc();
  setupMenu();

  // Динамический импорт: env должен быть выставлен до загрузки playwright.
  const { startServer } = await import('../src/server.js');
  serverHandle = await startServer({ port: 0, host: '127.0.0.1' });
  console.log(`[spider-desktop] http://127.0.0.1:${serverHandle.port}`);

  await createWindow();
  await setupTray();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch((err) => {
    console.error('[spider-desktop] error:', err);
    dialog.showErrorBox('Spider Solver', err?.message || String(err));
    app.quit();
  });

  app.on('before-quit', (event) => {
    isQuitting = true;
    if (cleanupDone) return;
    event.preventDefault();
    cleanupDone = true;
    (async () => {
      await serverHandle?.close();
      app.quit();
    })();
  });
}
