import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceManager } from './services.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Services ───────────────────────────────────────────────────────────────

const services = new ServiceManager([
  { name: 'lpr-service', port: 8765 },
  { name: 'camera-service', port: 8766 },
]);

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow(): void {
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
    return;
  }

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// ── App lifecycle ──────────────────────────────────────────────────────────

void app.whenReady().then(async () => {
  services.spawnAll();
  if (app.isPackaged) await services.waitAllHealthy();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => services.stopAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
