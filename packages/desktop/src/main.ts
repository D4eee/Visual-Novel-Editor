/**
 * Electron main process of the editor.
 * - Serves the editor UI and project/module files through the privileged `vne-fs:` / `vne-app:` schemes.
 * - Exposes the host API over IPC (same table as browser mode).
 * - Supports several project windows and recovers from renderer crashes.
 */
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, Menu, net } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHost } from '../../host/src/api';
import { within } from '../../host/src/fsutil';

// Packaged: resources/app/dist/desktop/main.js (asar is disabled so exported-game templates can be copied as plain files).
const DIST = path.resolve(__dirname, '..');
const RESOURCES = app.isPackaged ? (process as any).resourcesPath as string : path.resolve(__dirname, '..', '..', 'resources');
const EXAMPLES = app.isPackaged ? path.join(RESOURCES, 'examples') : path.resolve(__dirname, '..', '..', 'examples');

protocol.registerSchemesAsPrivileged([
  { scheme: 'vne-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'vne-fs', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const host = createHost({
  mode: 'electron',
  distDir: DIST,
  examplesDir: EXAMPLES,
  userDataDir: app.getPath('userData'),
  urlBase: 'vne-fs://fs/',
  templateDirs: [path.join(RESOURCES, 'runtime-templates')],
  dialogs: {
    async pickFolder(o) {
      const w = BrowserWindow.getFocusedWindow();
      const r = await dialog.showOpenDialog(w!, { title: o.title, defaultPath: o.defaultPath, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    async pickFiles(o) {
      const w = BrowserWindow.getFocusedWindow();
      const r = await dialog.showOpenDialog(w!, { title: o.title, filters: o.filters, properties: o.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'] });
      return r.canceled ? [] : r.filePaths;
    },
    reveal(p: string) { shell.showItemInFolder(p); },
  },
});

function createWindow(query = ''): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#14151c',
    title: 'Visual Novel Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(`vne-app://editor/index.html${query}`);
  // Never navigate the editor window away; open external links in the browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('vne-app://')) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: 'The editor window stopped unexpectedly.',
      detail: 'Your work is autosaved. Reload to recover the latest autosave.',
      buttons: ['Reload', 'Close'],
    });
    if (choice === 0) win.loadURL(`vne-app://editor/index.html?recover=1`);
    else win.close();
  });
  return win;
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('vne:command', cmd);
  const template: any[] = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
      { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: send('project.new') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('project.open') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('project.save') },
      { type: 'separator' },
      { label: 'Export Game…', accelerator: 'CmdOrCtrl+E', click: send('export.open') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Documentation', click: () => shell.openExternal('https://github.com/D4eee/Visual-Novel-Editor/tree/main/docs') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  protocol.handle('vne-app', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = within(path.join(DIST, u.host), rel || 'index.html');
    return net.fetch(pathToFileURL(file).href);
  });
  protocol.handle('vne-fs', async (req) => {
    const u = new URL(req.url);
    const file = await host.resolveFile(u.pathname);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href, { headers: req.headers });
  });
  ipcMain.handle('vne:host', async (_e, name: string, args: any) => {
    const fn = host.methods[name];
    if (!fn) throw new Error(`Unknown host method ${name}`);
    return fn(args);
  });
  ipcMain.handle('vne:window.new', () => { createWindow(); return true; });
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
