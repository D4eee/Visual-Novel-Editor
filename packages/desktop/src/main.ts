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
import { within, mimeOf } from '../../host/src/fsutil';

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

const MENU_TEXT: Record<string, Record<string, string>> = {
  en: {
    file: 'File', newWindow: 'New Window', newProject: 'New Project…', openProject: 'Open Project…', save: 'Save', export: 'Export Game…',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    view: 'View', reload: 'Reload', devTools: 'Developer Tools', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Full Screen',
    window: 'Window', minimize: 'Minimize', zoom: 'Zoom', close: 'Close Window', quit: 'Quit', help: 'Help', docs: 'Documentation', shortcuts: 'Keyboard Shortcuts',
  },
  'zh-CN': {
    file: '文件', newWindow: '新建窗口', newProject: '新建项目…', openProject: '打开项目…', save: '保存', export: '导出游戏…',
    edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    view: '视图', reload: '重新加载', devTools: '开发者工具', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullscreen: '切换全屏',
    window: '窗口', minimize: '最小化', zoom: '缩放', close: '关闭窗口', quit: '退出', help: '帮助', docs: '使用文档', shortcuts: '键盘快捷键',
  },
};
let menuLocale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

/** Native menu, in the editor's interface language. Undo/redo go to the editor (its own history), not to the page. */
function buildMenu(locale = menuLocale): void {
  menuLocale = MENU_TEXT[locale] ? locale : 'en';
  const m = MENU_TEXT[menuLocale];
  const isMac = process.platform === 'darwin';
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('vne:command', cmd);
  const template: any[] = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: m.file, submenu: [
      { label: m.newWindow, accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
      { label: m.newProject, accelerator: 'CmdOrCtrl+N', click: send('project.new') },
      { label: m.openProject, accelerator: 'CmdOrCtrl+O', click: send('project.open') },
      { label: m.save, accelerator: 'CmdOrCtrl+S', click: send('project.save') },
      { type: 'separator' },
      { label: m.export, accelerator: 'CmdOrCtrl+E', click: send('export.open') },
      { type: 'separator' },
      isMac ? { role: 'close', label: m.close } : { role: 'quit', label: m.quit },
    ] },
    { label: m.edit, submenu: [
      { label: m.undo, accelerator: 'CmdOrCtrl+Z', click: send('edit.undo') },
      { label: m.redo, accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: send('edit.redo') },
      { type: 'separator' },
      { role: 'cut', label: m.cut }, { role: 'copy', label: m.copy }, { role: 'paste', label: m.paste },
      { label: m.selectAll, accelerator: 'CmdOrCtrl+A', click: send('edit.selectAll') },
    ] },
    { label: m.view, submenu: [
      { role: 'reload', label: m.reload }, { role: 'toggleDevTools', label: m.devTools }, { type: 'separator' },
      { role: 'resetZoom', label: m.resetZoom }, { role: 'zoomIn', label: m.zoomIn }, { role: 'zoomOut', label: m.zoomOut }, { type: 'separator' },
      { role: 'togglefullscreen', label: m.fullscreen },
    ] },
    { label: m.window, submenu: [{ role: 'minimize', label: m.minimize }, { role: 'zoom', label: m.zoom }, ...(isMac ? [] : [{ role: 'close', label: m.close }])], role: 'window' },
    { label: m.help, role: 'help', submenu: [
      { label: m.shortcuts, click: send('help.shortcuts') },
      { label: m.docs, click: () => shell.openExternal('https://github.com/D4eee/Visual-Novel-Editor/tree/main/docs') },
    ] },
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
    const res = await net.fetch(pathToFileURL(file).href, { headers: req.headers });
    // The editor page (vne-app:) draws project images into canvases (effects, thumbnails, icon export);
    // allow it to read them back without tainting the canvas.
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    if (!headers.has('Content-Type')) headers.set('Content-Type', mimeOf(file));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
  ipcMain.handle('vne:host', async (_e, name: string, args: any) => {
    const fn = host.methods[name];
    if (!fn) throw new Error(`Unknown host method ${name}`);
    return fn(args);
  });
  ipcMain.handle('vne:window.new', () => { createWindow(); return true; });
  ipcMain.handle('vne:locale', (_e, locale: string) => { if (locale !== menuLocale) buildMenu(locale); return true; });
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
