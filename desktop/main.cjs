'use strict';

const { app, BrowserWindow, Menu, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_SCHEME = 'kuubik';
const APP_HOST = 'app';
const smokeOutputPath = process.env.KUUBIK_DRAW_SMOKE_OUTPUT || '';
const smokeMode = process.argv.includes('--smoke-test') || Boolean(smokeOutputPath);
const smokeUserDataPath = smokeMode ? fsSync.mkdtempSync(path.join(os.tmpdir(), 'kuubik-draw-lite-smoke-')) : '';
if (smokeUserDataPath) app.setPath('userData', smokeUserDataPath);
let mainWindow = null;
let blockedNetworkRequests = 0;
const consoleErrors = [];

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
}]);

app.setAppUserModelId('ee.kuubik.draw.lite');

ipcMain.handle('app:info', () => ({
  name: 'Kuubik Draw Lite',
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
}));

function webRoot() {
  return path.join(app.getAppPath(), 'apps', 'web', 'dist');
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  })[extension] || 'application/octet-stream';
}

function responseHeaders(filePath) {
  return {
    'Content-Type': contentType(filePath),
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; worker-src 'self' blob:",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

async function serveApplication(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });

    const routePath = decodeURIComponent(url.pathname);
    const relativePath = routePath === '/' || routePath === '/d/local'
      ? 'index.html'
      : routePath === '/scope' || routePath === '/scope/'
        ? 'scope.html'
        : routePath.replace(/^\/+/, '');
    const root = path.resolve(webRoot());
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }

    const bytes = await fs.readFile(filePath);
    return new Response(bytes, { status: 200, headers: responseHeaders(filePath) });
  } catch (error) {
    const status = error && error.code === 'ENOENT' ? 404 : 500;
    return new Response(status === 404 ? 'Not found' : 'Application load failed', { status });
  }
}

async function writeSmokeReport(report, exitCode) {
  const serialized = JSON.stringify(report, null, 2);
  if (smokeOutputPath) await fs.writeFile(smokeOutputPath, serialized, 'utf8');
  console.log(`KUUBIK_DRAW_SMOKE=${JSON.stringify(report)}`);
  app.exit(exitCode);
}

async function runLinePointerSmoke() {
  return mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    void (async () => {
      const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
      const readDocument = async () => {
        const database = await new Promise((resolveOpen, rejectOpen) => {
          const request = indexedDB.open('kuubik-draw');
          request.onsuccess = () => resolveOpen(request.result);
          request.onerror = () => rejectOpen(request.error);
        });
        const stored = await new Promise((resolveRead, rejectRead) => {
          const request = database.transaction('documents', 'readonly').objectStore('documents').get('local');
          request.onsuccess = () => resolveRead(request.result);
          request.onerror = () => rejectRead(request.error);
        });
        database.close();
        return stored;
      };
      const lineButton = document.querySelector('[aria-label="Ribbon Line command"]');
      const canvas = document.querySelector('[aria-label="Kuubik Draw joonestusala"]');
      if (!(lineButton instanceof HTMLButtonElement) || !(canvas instanceof HTMLCanvasElement)) {
        throw new Error('LINE nupp või joonestusala puudub packaged rendererist.');
      }
      const before = await readDocument();
      const beforeLines = before.entities.filter((entity) => entity.kind === 'line').length;
      lineButton.click();
      await frame();
      await frame();
      const rect = canvas.getBoundingClientRect();
      const first = { x: rect.left + rect.width * 0.28, y: rect.top + rect.height * 0.32 };
      const second = { x: rect.left + rect.width * 0.68, y: rect.top + rect.height * 0.68 };
      const pointer = (type, point) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: point.x,
        clientY: point.y,
      }));
      pointer('pointerdown', first);
      pointer('pointerup', first);
      await frame();
      await frame();
      const previewStarted = Boolean(document.querySelector('[data-testid="line-canvas-preview"]'));
      pointer('pointermove', second);
      await frame();
      pointer('pointerdown', second);
      pointer('pointerup', second);
      const started = Date.now();
      let after = await readDocument();
      while (after.revision <= before.revision && Date.now() - started <= 10000) {
        await new Promise((done) => setTimeout(done, 50));
        after = await readDocument();
      }
      const afterLines = after.entities.filter((entity) => entity.kind === 'line');
      const created = afterLines[afterLines.length - 1];
      resolve({
        beforeRevision: before.revision,
        afterRevision: after.revision,
        beforeLines,
        afterLines: afterLines.length,
        previewStarted,
        previewCleared: !document.querySelector('[data-testid="line-canvas-preview"]'),
        createdLength: created && created.kind === 'line'
          ? Math.hypot(created.end.x - created.start.x, created.end.y - created.start.y)
          : 0,
      });
    })().catch(reject);
  })`, true);
}

async function runSmokeReadBack() {
  let report;
  let exitCode = 0;
  let state = null;
  try {
    state = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = async () => {
        const shell = document.querySelector('.app-shell');
        const badge = document.querySelector('[data-testid="lite-profile-badge"]');
        const storage = document.querySelector('.storage-state');
        const canvas = document.querySelector('.drawing-area canvas');
        if (shell && badge && canvas && storage && storage.dataset.storageState !== 'loading') {
          const databases = typeof indexedDB.databases === 'function'
            ? await indexedDB.databases()
            : [];
          resolve({
            title: document.title,
            url: location.href,
            profile: shell.dataset.productProfile || '',
            visualProfile: shell.dataset.scopeProfile || '',
            scopeSize: Number(shell.dataset.scopeSize || 0),
            badge: badge.textContent || '',
            storageState: storage.dataset.storageState || '',
            canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
            orientationIndicatorPresent: Boolean(document.querySelector('[data-testid="view-orientation-indicator"]')),
            indexedDbNames: databases.map((entry) => entry.name).filter(Boolean),
            desktopBridge: Boolean(window.kuubikDesktop && window.kuubikDesktop.isDesktop),
          });
          return;
        }
        if (Date.now() - started > 30000) {
          reject(new Error('Lite-rakendus ei saavutanud valmisolekut 30 sekundiga.'));
          return;
        }
        setTimeout(poll, 75);
      };
      poll();
    })`, true);
    const linePointer = await runLinePointerSmoke();
    const valid = state.title === 'Kuubik Draw'
      && state.url === 'kuubik://app/d/local'
      && state.profile === 'kuubik-draw-lite-v1'
      && state.visualProfile === 'autocad-familiar-clean'
      && state.scopeSize === 20
      && state.badge.includes('20 funktsiooni')
      && ['ready', 'recovered'].includes(state.storageState)
      && state.canvas.width > 0
      && state.canvas.height > 0
      && state.indexedDbNames.includes('kuubik-draw')
      && state.desktopBridge
      && !state.orientationIndicatorPresent
      && linePointer.afterRevision === linePointer.beforeRevision + 1
      && linePointer.afterLines === linePointer.beforeLines + 1
      && linePointer.previewStarted
      && linePointer.previewCleared
      && linePointer.createdLength > 100;
    if (!valid) throw new Error('Portable EXE read-back ei vasta Lite v1 lepingule.');
    if (consoleErrors.length > 0) throw new Error(`Renderer kirjutas konsooli vea: ${consoleErrors[0]}`);
    report = {
      status: 'PASS',
      packaged: app.isPackaged,
      version: app.getVersion(),
      runtime: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      offlineNetworkBlocked: true,
      blockedNetworkRequests,
      consoleErrors,
      isolatedUserData: Boolean(smokeUserDataPath),
      linePointer,
      ...state,
    };
  } catch (error) {
    exitCode = 2;
    report = {
      status: 'FAIL',
      packaged: app.isPackaged,
      version: app.getVersion(),
      offlineNetworkBlocked: true,
      blockedNetworkRequests,
      consoleErrors,
      state,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await writeSmokeReport(report, exitCode);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#171a1d',
    title: 'Kuubik Draw Lite',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== 'kuubik://app/d/local') event.preventDefault();
  });
  mainWindow.webContents.on('console-message', (_event, levelOrDetails, legacyMessage) => {
    const level = typeof levelOrDetails === 'object' ? levelOrDetails.level : levelOrDetails;
    const message = typeof levelOrDetails === 'object' ? levelOrDetails.message : legacyMessage;
    if (level === 'error' || Number(level) >= 2) consoleErrors.push(String(message));
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
    if (isMainFrame) consoleErrors.push(`did-fail-load ${code}: ${description} (${validatedUrl})`);
  });
  mainWindow.once('ready-to-show', () => {
    if (!smokeMode) mainWindow.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.once('did-finish-load', () => {
    if (smokeMode) void runSmokeReadBack();
  });
  void mainWindow.loadURL('kuubik://app/d/local');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  protocol.handle(APP_SCHEME, serveApplication);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => {
      blockedNetworkRequests += 1;
      callback({ cancel: true });
    },
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
