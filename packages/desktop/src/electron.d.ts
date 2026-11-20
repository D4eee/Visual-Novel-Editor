/**
 * The web edition does not install Electron. Exported desktop games still use
 * the player shell (player-main.ts / player-preload.ts), which runs inside the
 * Electron runtime copied at export time; these declarations let it type-check.
 */
declare module 'electron' {
  export const app: any;
  export const BrowserWindow: any;
  export const protocol: any;
  export const net: any;
  export const shell: any;
  export const ipcMain: any;
  export const contextBridge: any;
  export const ipcRenderer: any;
}
