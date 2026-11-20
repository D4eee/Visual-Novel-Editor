/**
 * Main process of exported games. The game folder sits next to this file
 * (resources/app/game) and is served from the privileged `app:` scheme so ES
 * module imports of runtime modules work. No editor code is included.
 */
import { app, BrowserWindow, protocol, net, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const GAME = path.join(__dirname, 'game');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

interface Config { title: string; resolution: { width: number; height: number }; window: { mode: string; resizable: boolean; width: number; height: number } }

function readConfig(): Config {
  try { return JSON.parse(fs.readFileSync(path.join(GAME, 'config.json'), 'utf8')); }
  catch { return { title: 'Game', resolution: { width: 1280, height: 720 }, window: { mode: 'windowed', resizable: true, width: 1280, height: 720 } }; }
}

app.whenReady().then(() => {
  const cfg = readConfig();
  app.setName(cfg.title);
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(GAME, rel);
    if (!file.startsWith(GAME + path.sep) && file !== GAME) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  const iconPng = path.join(GAME, 'icon.png');
  const iconIco = path.join(GAME, 'icon.ico');
  const win = new BrowserWindow({
    width: cfg.window.width || cfg.resolution.width,
    height: cfg.window.height || cfg.resolution.height,
    useContentSize: true,
    resizable: cfg.window.resizable !== false,
    fullscreen: cfg.window.mode === 'fullscreen',
    frame: cfg.window.mode !== 'borderless',
    backgroundColor: '#000000',
    title: cfg.title,
    icon: fs.existsSync(iconIco) && process.platform === 'win32' ? iconIco : fs.existsSync(iconPng) ? iconPng : undefined,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.setAspectRatio(cfg.resolution.width / cfg.resolution.height);
  win.loadURL('app://game/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  ipcMain.handle('vne:quit', () => app.quit());
  ipcMain.handle('vne:fullscreen', (_e, v: boolean) => win.setFullScreen(!!v));
});

app.on('window-all-closed', () => app.quit());
