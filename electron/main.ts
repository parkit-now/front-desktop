import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceManager, type ServiceConfig } from './services.js';
import { resolveServiceRuntime, type ServiceName } from './serviceRuntime.js';
import { destroyPrintWindows, listPrinters, printTicketHtml } from './print.js';
import {
  cameraServiceEnv,
  readCameraConfig,
  resolveCameraSource,
  resolveSourceFor,
  writeCameraConfig,
  type CameraConfigInput,
} from './cameraConfig.js';

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
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.resolve(__dirname, '..', '..', 'build', 'icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: windowIcon,
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

/**
 * Le manda al servicio de cámara la configuración guardada en este equipo.
 *
 * Reintenta porque el servicio puede tardar en levantar: con PyInstaller el
 * arranque en frío ronda los segundos, y en desarrollo lo lanza el Makefile en
 * paralelo con Electron. Si no contesta en ese lapso se abandona en silencio —
 * el servicio sigue con su cámara por defecto y el usuario puede volver a
 * guardar desde el panel.
 */
async function applyStoredCameraConfig(port: number): Promise<void> {
  const config = readCameraConfig();
  const source = resolveCameraSource();
  if (!source) return;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/config/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          cameraId: config.cameraId,
          location: config.location,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
    } catch {
      // Todavía no levantó.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.warn('[camera] no se pudo aplicar la cámara guardada al servicio');
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
    const serviceLogDir = path.join(userData, 'logs', 'services');
    fs.mkdirSync(serviceLogDir, { recursive: true });

    // Runtime-dependent env, layered on top of whatever the resolver decided.
    const runtimeEnv: Partial<Record<ServiceName, Record<string, string>>> = {
      'camera-service': {
        // Writable data dir so the service works when the bundle is read-only.
        CAMERA_DB_PATH: path.join(userData, 'camera.db'),
        CAMERA_IMAGES_DIR: path.join(userData, 'images'),
        // La cámara IP de este equipo, si está configurada. Devuelve `{}` cuando
        // no lo está, y entonces el servicio usa su default (la webcam USB): un
        // equipo que todavía no migró sigue andando igual.
        ...cameraServiceEnv(),
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
      logPath: path.join(serviceLogDir, `${name}.log`),
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

    // Aplicarle al servicio la cámara guardada, ya arrancado.
    //
    // El `env` del spawn de arriba solo alcanza cuando ES Electron el que lanza
    // el servicio. En desarrollo no lo es: `make dev` corre con
    // PARKIT_MANAGE_SERVICES=0 y levanta cámara y LPR por su cuenta, sin
    // CAMERA_SOURCE — así que la cámara configurada se perdía en cada reinicio
    // y el equipo volvía a la webcam. Empujar la configuración después hace que
    // funcione sin importar quién arrancó el proceso.
    //
    // Es idempotente: si el servicio ya está en esa cámara, `set_source` corta
    // sin reconectar y el video no se interrumpe.
    void applyStoredCameraConfig(ports['camera-service']);

    const win = createWindow();
    mainWindow = win;
    let shuttingDownServices = false;

    // El panel de configuración necesita `getUserMedia` una vez para que el
    // navegador revele los NOMBRES de las webcams (sin permiso, `enumerateDevices`
    // devuelve los dispositivos con el label vacío).
    //
    // Se concede explícitamente en vez de confiar en el default de Electron, que
    // es justo el tipo de cosa que cambia entre versiones mayores: si algún día
    // pasara a denegar, la lista se quedaría sin nombres sin que nadie entienda
    // por qué. Todo lo demás se niega — esta app no necesita micrófono,
    // ubicación ni notificaciones.
    win.webContents.session.setPermissionRequestHandler(
      (_contents, permission, callback) => {
        callback(permission === 'media');
      },
    );

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

    // ── Cámara ──────────────────────────────────────────────────────────────
    //
    // La contraseña NUNCA cruza hacia el renderer: `readCameraConfig` la omite y
    // solo informa `hasPassword`. El panel manda `password` únicamente cuando el
    // usuario la escribe de nuevo; si no la manda, se conserva la guardada.
    const CAMERA_PORT = ports['camera-service'];

    ipcMain.handle('camera:getConfig', () => readCameraConfig());

    ipcMain.handle('camera:probe', async (_event, input: CameraConfigInput) => {
      const source = resolveSourceFor(input);
      if (!source) return { ok: false, error: 'falta_direccion' };
      try {
        const res = await fetch(`http://127.0.0.1:${CAMERA_PORT}/probe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source }),
          // El probe del servicio ya corta a los 5 s; este margen es para que
          // el error sea el suyo (descriptivo) y no un timeout nuestro.
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { ok: false, error: 'servicio_no_disponible' };
        return (await res.json()) as unknown;
      } catch {
        return { ok: false, error: 'servicio_no_disponible' };
      }
    });

    ipcMain.handle(
      'camera:setConfig',
      async (_event, input: CameraConfigInput) => {
        writeCameraConfig(input);
        const source = resolveCameraSource();
        if (!source) return { ok: true, reconnected: false };
        try {
          // Reconfigurar en caliente evita reiniciar la app entera para probar
          // un cambio de cámara. Si el servicio no contesta, la config igual
          // quedó guardada y se aplica en el próximo arranque.
          const res = await fetch(
            `http://127.0.0.1:${CAMERA_PORT}/config/source`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source,
                cameraId: input.cameraId,
                location: input.location,
              }),
              signal: AbortSignal.timeout(10_000),
            },
          );
          return { ok: true, reconnected: res.ok };
        } catch {
          return { ok: true, reconnected: false };
        }
      },
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
