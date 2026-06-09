import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceManager } from './services.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────

void app.whenReady().then(async () => {
  // userData is only available after app is ready.
  const userData = app.getPath('userData');

  const services = new ServiceManager([
    { name: 'lpr-service', port: 8765 },
    {
      name: 'camera-service',
      port: 8766,
      // Point the camera service at a writable directory so it works in
      // a signed/packaged app where the bundle itself is read-only.
      env: {
        CAMERA_DB_PATH: path.join(userData, 'camera.db'),
        CAMERA_IMAGES_DIR: path.join(userData, 'images'),
      },
    },
  ]);

  services.spawnAll();
  const failed = app.isPackaged ? await services.waitAllHealthy() : [];

  const win = createWindow();

  // Once the renderer is loaded, forward any health failures so the UI can
  // show an actionable error instead of silently operating with broken services.
  if (failed.length > 0) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('services:failed', failed);
    });
  }

  // Allow the renderer to query health status on demand (e.g. after reload).
  ipcMain.handle('services:getFailed', () => failed);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => services.stopAll());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
