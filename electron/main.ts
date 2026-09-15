import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceManager, type ServiceConfig } from './services.js';
import { resolveServiceRuntime, type ServiceName } from './serviceRuntime.js';
import { destroyPrintWindows, listPrinters, printTicketHtml } from './print.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OAUTH_PROTOCOL = 'parkit';

// ── Deep-link (OAuth callback) plumbing ────────────────────────────────────
//
// The renderer runs the social-login flow in the user's real browser and
// asks Supabase to redirect to `parkit://auth/callback#access_token=...`.
// The OS hands that URL back to this process; we forward it to the renderer,
// which applies the session (`hydrateSessionFromUrl`).

let mainWindow: BrowserWindow | null = null;
// Holds a parkit:// URL that arrived before the renderer could receive it
// (cold start via deep link, or a callback during the initial page load).
let pendingDeepLink: string | null = null;

function isDeepLink(value: string): boolean {
  return value.startsWith(`${OAUTH_PROTOCOL}://`);
}

function deliverDeepLink(url: string): void {
  if (!isDeepLink(url)) return;

  const contents = mainWindow?.webContents;
  if (contents && !contents.isLoading()) {
    contents.send('oauth:callback', url);
  } else {
    pendingDeepLink = url;
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  win.webContents.once('did-finish-load', () => {
    if (pendingDeepLink) {
      win.webContents.send('oauth:callback', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // Windows/Linux: a deep link launches a second instance whose argv carries
  // the URL; forward it to the already-running instance.
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(isDeepLink);
    if (url) {
      deliverDeepLink(url);
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: deep links arrive here (can fire before `whenReady`).
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });

  // Register parkit:// as this app's URL-scheme handler.
  if (process.defaultApp && process.argv.length >= 2) {
    // Dev run (`electron dist/main/main.js`): point the OS at this invocation.
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL);
  }

  // Cold start on Windows/Linux: the URL is already in our own argv.
  const argvDeepLink = process.argv.find(isDeepLink);
  if (argvDeepLink) pendingDeepLink = argvDeepLink;

  void app.whenReady().then(async () => {
    // userData is only available after app is ready.
    const userData = app.getPath('userData');

    // Runtime-dependent env, layered on top of whatever the resolver decided.
    const runtimeEnv: Partial<Record<ServiceName, Record<string, string>>> = {
      'camera-service': {
        // Writable data dir so the service works when the bundle is read-only.
        CAMERA_DB_PATH: path.join(userData, 'camera.db'),
        CAMERA_IMAGES_DIR: path.join(userData, 'images'),
      },
    };
    const ports: Record<ServiceName, number> = {
      'lpr-service': 8765,
      'camera-service': 8766,
    };

    const runtime = resolveServiceRuntime();
    const serviceConfigs: ServiceConfig[] = (
      Object.entries(runtime.launchers) as [
        ServiceName,
        ServiceConfig['launcher'],
      ][]
    ).map(([name, launcher]) => ({
      name,
      port: ports[name],
      launcher,
      env: runtimeEnv[name],
    }));

    if (runtime.manage) {
      for (const cfg of serviceConfigs) {
        console.log(
          `[main] ${cfg.name}: ${cfg.launcher.source} → ${cfg.launcher.cmd}`,
        );
      }
    } else {
      console.log(
        '[main] service supervision disabled — camera/LPR are expected to be ' +
          'started externally (e.g. `make dev`, PARKIT_MANAGE_SERVICES=0)',
      );
    }

    const services = new ServiceManager(serviceConfigs);
    await services.spawnAll();
    const failed = runtime.manage ? await services.waitAllHealthy() : [];

    const win = createWindow();
    mainWindow = win;
    let shuttingDownServices = false;

    // Once the renderer is loaded, forward any health failures so the UI can
    // show an actionable error instead of silently operating with broken
    // services.
    if (failed.length > 0) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('services:failed', failed);
      });
    }

    // Allow the renderer to query health status on demand (e.g. after reload).
    ipcMain.handle('services:getFailed', () => failed);

    // Open OAuth consent URLs in the user's default browser.
    ipcMain.handle('shell:openExternal', (_event, url: string) =>
      shell.openExternal(url),
    );

    ipcMain.handle('printer:list', () => listPrinters(mainWindow));
    ipcMain.handle(
      'printer:printTicket',
      (_event, payload: { html: string; deviceName: string | null }) =>
        printTicketHtml(mainWindow, payload),
    );

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });

    app.on('before-quit', (event) => {
      if (shuttingDownServices) return;
      destroyPrintWindows();
      event.preventDefault();
      shuttingDownServices = true;
      void services.stopAll().finally(() => app.quit());
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
