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
   */
  onServiceCrashed: (callback: (name: string) => void) => {
    ipcRenderer.on('services:crashed', (_event, name: string) =>
      callback(name),
    );
  },
});
