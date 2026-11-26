/**
 * Electron-обёртка над локальным веб-интерфейсом.
 *
 * В main-процессе поднимается тот же сервер, что и у `npm run web`, но на
 * свободном порту. Главное окно показывает интерфейс, а страница игры живёт
 * в WebContentsView внутри этого же окна — отдельного окна Chromium больше нет.
 */
import {
  app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, shell,
} from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const GAME_URL = 'https://razlozhi.ru/patience-spider2';

let mainWindow = null;
let gameView = null;
let serverHandle = null;
let cleanupDone = false;
const gamePopups = new Set();

if (process.env.SPIDER_IGNORE_CERT_ERRORS === '1') {
  // Только для отладки в сетях с корпоративным MITM-прокси.
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

function configureEnvironment() {
  // Свой профиль, чтобы десктоп не конфликтовал с CLI/веб-версией.
  // Electron хранит куки в default session в userData, отдельный Chromium-
  // профиль вроде ~/.razlozhi-spider-solver-profile больше не нужен.
  const profile = path.join(app.getPath('userData'), 'browser-profile');
  process.env.SPIDER_PROFILE_DIR = profile;
  mkdirSync(profile, { recursive: true });

  // Файлы с ходами тоже должны попадать в пользовательскую папку — в
  // установленном приложении рабочий каталог может быть только для чтения.
  const logDir = path.join(app.getPath('userData'), 'moves');
  process.env.SPIDER_LOG_DIR = logDir;
  mkdirSync(logDir, { recursive: true });
  return profile;
}

function clampBounds(bounds) {
  if (!bounds || bounds.width < 40 || bounds.height < 40) return null;
  const [windowWidth, windowHeight] = mainWindow.getContentSize();
  const x = Math.max(0, Math.min(Math.round(bounds.x), windowWidth - 40));
  const y = Math.max(0, Math.min(Math.round(bounds.y), windowHeight - 40));
  return {
    x,
    y,
    width: Math.max(40, Math.min(Math.round(bounds.width), windowWidth - x)),
    height: Math.max(40, Math.min(Math.round(bounds.height), windowHeight - y)),
  };
}

function setupIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    profile: process.env.SPIDER_PROFILE_DIR || null,
    packaged: app.isPackaged,
    embeddedGame: true,
    logDir: process.env.SPIDER_LOG_DIR || null,
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

  ipcMain.handle('app:open-log-dir', async () => {
    const dir = process.env.SPIDER_LOG_DIR;
    if (!dir) return false;
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  });

  // Интерфейс сообщает координаты области, куда встроить страницу игры.
  ipcMain.on('game:bounds', (_event, bounds) => {
    if (!gameView || !mainWindow) return;
    const next = clampBounds(bounds);
    if (!next) {
      gameView.setVisible(false);
      return;
    }
    gameView.setBounds(next);
    gameView.setVisible(true);
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
          click: async () => shell.openExternal(GAME_URL),
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

function createGameView() {
  gameView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.contentView.addChildView(gameView);
  gameView.setVisible(false);
  gameView.webContents.setBackgroundThrottling(false);

  // OAuth-провайдер открывает новые вкладки — показываем их отдельными
  // окнами, но это уже окна входа, а не игровое окно.
  gameView.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
    const popup = new BrowserWindow({
      width: 1100,
      height: 800,
      show: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    gamePopups.add(popup);
    popup.on('closed', () => gamePopups.delete(popup));
    popup.loadURL(url);
    return { action: 'deny' };
  });

  gameView.webContents.on('did-fail-load', (_event, code, description) => {
    if (code === -3) return; // навигация отменена — нормально при смене колоды
    console.warn('[spider-desktop] игра не загрузилась:', code, description);
  });

  gameView.webContents.loadURL(GAME_URL).catch((err) => {
    console.warn('[spider-desktop] стартовая загрузка игры:', err?.message || err);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 980,
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

  createGameView();

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

  mainWindow.on('closed', () => {
    mainWindow = null;
    gameView = null;
  });

  await mainWindow.loadURL(origin);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
}

async function bootstrap() {
  const profile = configureEnvironment();
  setupIpc();
  setupMenu();

  const { Runner } = await import('../src/runner.js');
  const { EmbeddedSpiderGame } = await import('../src/electron-browser.js');
  const { startServer } = await import('../src/server.js');

  const runner = new Runner({
    createGame: () => Promise.resolve(new EmbeddedSpiderGame(gameView, { profile })),
  });
  serverHandle = await startServer({ port: 0, host: '127.0.0.1', runner });
  console.log(`[spider-desktop] http://127.0.0.1:${serverHandle.port}`);

  await createWindow();
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

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (event) => {
    if (cleanupDone) return;
    event.preventDefault();
    cleanupDone = true;
    (async () => {
      for (const popup of gamePopups) {
        if (!popup.isDestroyed()) popup.destroy();
      }
      gamePopups.clear();
      await serverHandle?.close();
      app.quit();
    })();
  });
}
