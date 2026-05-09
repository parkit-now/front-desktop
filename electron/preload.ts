import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('parkitDesktop', {
  platform: process.platform,
});
