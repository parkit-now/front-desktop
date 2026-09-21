import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('parkitDesktop', {
  platform: process.platform,

  /**
   * Subscribe to the one-time push sent by main when one or more services
   * fail their health check after launch. The callback receives the list of
   * service names that did not become healthy.
   */
  onServicesFailed: (callback: (names: string[]) => void) => {
    ipcRenderer.once('services:failed', (_event, names: string[]) =>
      callback(names),
    );
  },

  /**
   * Ask main for the list of services that failed their health check.
   * Useful when the renderer reloads and misses the one-time push event.
   */
  getFailedServices: (): Promise<string[]> =>
    ipcRenderer.invoke('services:getFailed'),

  /**
   * Subscribe to post-startup service crashes. Called each time a previously
   * healthy service exits unexpectedly so the UI can alert the operator.
   * Returns an unsubscribe function — call it on component unmount to avoid
   * accumulating listeners across React re-mounts.
   */
  onServiceCrashed: (callback: (name: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, name: string) =>
      callback(name);
    ipcRenderer.on('services:crashed', handler);
    return () => ipcRenderer.removeListener('services:crashed', handler);
  },

  /**
   * Open a URL in the user's default browser. Used by the OAuth flow so the
   * provider consent screen runs outside the Electron window (which is served
   * from `file://` and cannot be a valid Supabase redirect target).
   */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),

  /**
   * Subscribe to the `parkit://auth/callback` deep link that carries the OAuth
   * tokens back from the browser. Returns an unsubscribe function.
   */
  onOAuthCallback: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) =>
      callback(url);
    ipcRenderer.on('oauth:callback', handler);
    return () => ipcRenderer.removeListener('oauth:callback', handler);
  },

  listPrinters: (): Promise<
    { name: string; displayName: string; isDefault: boolean }[]
  > => ipcRenderer.invoke('printer:list'),

  printTicket: (payload: {
    html: string;
    deviceName: string | null;
    tailFeedMm: number;
    pageWidthMm: number | null;
  }): Promise<{ ok: true } | { ok: false; reason: string; detail?: string }> =>
    ipcRenderer.invoke('printer:printTicket', payload),

  // ── Cámara ────────────────────────────────────────────────────────────────
  //
  // La contraseña es de una sola vía: se puede mandar, nunca se puede leer.
  // `getCameraConfig` devuelve `hasPassword` en vez del valor, así que ni el
  // renderer ni el DevTools de quien abra la app pueden verla.

  getCameraConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('camera:getConfig'),

  probeCamera: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('camera:probe', config),

  setCameraConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('camera:setConfig', config),

  /** Ajustes VIGENTES del servicio de detección (no los guardados en disco). */
  getCameraTuning: (): Promise<unknown> =>
    ipcRenderer.invoke('camera:getTuning'),

  /** Vuelve la calibración a los valores con los que arranca el servicio. */
  resetCameraTuning: (): Promise<unknown> =>
    ipcRenderer.invoke('camera:resetTuning'),
});
