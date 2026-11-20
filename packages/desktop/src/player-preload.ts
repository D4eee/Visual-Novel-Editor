import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vnePlayer', {
  quit: () => ipcRenderer.invoke('vne:quit'),
  setFullscreen: (v: boolean) => ipcRenderer.invoke('vne:fullscreen', v),
});
