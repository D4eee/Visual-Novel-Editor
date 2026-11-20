import { contextBridge, ipcRenderer, webUtils } from 'electron';

/** The only bridge between the sandboxed editor UI and the operating system. */
contextBridge.exposeInMainWorld('vneHost', {
  invoke: (name: string, args: unknown) => ipcRenderer.invoke('vne:host', name, args),
  newWindow: () => ipcRenderer.invoke('vne:window.new'),
  /** Keep the native menu in the editor's interface language. */
  setLocale: (locale: string) => ipcRenderer.invoke('vne:locale', locale),
  onCommand: (fn: (cmd: string) => void) => {
    const listener = (_e: unknown, cmd: string) => fn(cmd);
    ipcRenderer.on('vne:command', listener);
    return () => ipcRenderer.removeListener('vne:command', listener);
  },
  /** Absolute path of a file dropped from the OS (Electron ≥ 32 removed File.path). */
  pathForFile: (file: File) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
