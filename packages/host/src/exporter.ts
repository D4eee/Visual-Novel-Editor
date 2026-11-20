import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import type { Project, ModuleManifest } from '@vne/core';
import { usedAssetIds, usedTypeIds, ownerOfType } from '@vne/core';
import { atomicWrite, copyDir, exists, removeOutputDir, safeName, within } from './fsutil';
import { extractZip, zipDir } from './zip';
import type { ModuleStore } from './modules';
import type { TemplateStore, Platform, Arch } from './templates';

export type ExportTarget = 'web' | 'mac-arm64' | 'mac-x64' | 'win-x64';

export interface ExportOptions {
  outputDir: string;
  targets: ExportTarget[];
  /** PNG icons rendered by the editor, keyed by pixel size. */
  icons?: Record<number, string>;
  zipWindows?: boolean;
}

export interface ExportContext {
  playerDir: string;
  playerShellDir: string;
  modules: ModuleStore;
  templates: TemplateStore;
  log: (msg: string) => void;
}

export interface ExportResult {
  outputs: { target: ExportTarget; path: string }[];
  warnings: string[];
}

const MARKER = '.vne-export';

/** Remove editor-only data before shipping. */
export function stripForExport(project: Project): Project {
  const p: any = JSON.parse(JSON.stringify(project));
  delete p.editor;
  for (const n of Object.values<any>(p.nodes)) {
    delete n.notes;
    if (n.type === 'core.comment') delete p.nodes[n.id];
  }
  for (const n of Object.values<any>(p.nodes)) if (n.type === 'core.scene') for (const s of n.data.scripts || []) { delete s.x; delete s.y; }
  return p;
}

/** Module ids a project needs at runtime: declared dependencies plus owners of used types. */
export function requiredModuleIds(project: Project): Set<string> {
  const ids = new Set(project.modules.filter((m) => m.enabled).map((m) => m.id));
  const used = usedTypeIds(project);
  for (const set of Object.values(used)) for (const t of set) { const o = ownerOfType(t); if (o) ids.add(o); }
  return ids;
}

export async function buildGameFolder(ctx: ExportContext, projectDir: string, project: Project, dest: string, opts: ExportOptions): Promise<string[]> {
  const warnings: string[] = [];
  await fsp.mkdir(dest, { recursive: true });
  const shipped = stripForExport(project);

  // Assets: only those referenced anywhere in the project.
  const used = usedAssetIds(project);
  const missing: string[] = [];
  for (const a of project.assets) {
    if (!used.has(a.id)) continue;
    const src = within(projectDir, a.path);
    if (!(await exists(src))) { missing.push(`${a.name} (${a.path})`); continue; }
    const out = within(dest, a.path);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.copyFile(src, out);
  }
  if (missing.length) throw new Error(`Missing asset files:\n${missing.join('\n')}`);
  shipped.assets = shipped.assets.filter((a) => used.has(a.id));
  ctx.log(`Copied ${shipped.assets.length} assets`);

  // Runtime modules (editor entry points are never shipped).
  const need = requiredModuleIds(project);
  const all = await ctx.modules.list(projectDir);
  const byId = new Map(all.map((m) => [m.manifest.id, m]));
  const queue = [...need];
  const included = new Map<string, (typeof all)[number]>();
  while (queue.length) {
    const id = queue.shift()!;
    if (included.has(id)) continue;
    const m = byId.get(id);
    if (!m) throw new Error(`The project needs module "${id}", which is not installed.`);
    if (!m.compatible) throw new Error(`Module "${id}" is incompatible: ${m.problems.join('; ')}`);
    included.set(id, m);
    queue.push(...Object.keys(m.manifest.dependencies || {}));
  }
  const moduleSources: { manifest: ModuleManifest; baseUrl: string; locales: Record<string, Record<string, string>> }[] = [];
  for (const [id, m] of included) {
    if (!m.manifest.runtime) { ctx.log(`Skipped editor-only module ${id}`); continue; }
    const target = path.join(dest, 'modules', id);
    const editorEntry = m.manifest.editor ? m.manifest.editor.replace(/^\.\//, '') : null;
    await copyDir(m.dir, target, (rel) => rel !== editorEntry && !rel.startsWith('editor/') && !rel.startsWith('src/') && !rel.startsWith('node_modules') && !rel.startsWith('.') && !rel.endsWith('.ts') && rel !== 'package.json');
    const manifest = { ...m.manifest };
    delete manifest.editor;
    await atomicWrite(path.join(target, 'module.json'), JSON.stringify(manifest, null, 2));
    moduleSources.push({ manifest, baseUrl: `modules/${id}/`, locales: m.locales });
    ctx.log(`Included runtime module ${id}@${m.manifest.version}`);
  }

  // Player
  await fsp.copyFile(path.join(ctx.playerDir, 'player.js'), path.join(dest, 'player.js'));
  const title = project.settings.title || project.name;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>\n<link rel="icon" href="${opts.icons?.[512] ? 'icon.png' : 'data:,'}">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#game{position:fixed;inset:0}</style>
</head><body><div id="game"></div>
<script src="game.js"></script>
<script src="player.js"></script>
</body></html>`;
  await atomicWrite(path.join(dest, 'index.html'), html);
  await atomicWrite(path.join(dest, 'game.js'), `window.__VNE_GAME__ = ${JSON.stringify({ project: shipped, modules: moduleSources, assetBase: './' })};\n`);
  await atomicWrite(path.join(dest, 'config.json'), JSON.stringify({ title, version: project.settings.version, identifier: project.settings.identifier, resolution: project.settings.resolution, window: project.settings.window }, null, 2));
  if (opts.icons?.[512]) await fsp.writeFile(path.join(dest, 'icon.png'), Buffer.from(opts.icons[512], 'base64'));
  return warnings;
}

export async function exportGame(ctx: ExportContext, projectDir: string, project: Project, opts: ExportOptions): Promise<ExportResult> {
  const name = safeName(project.settings.title || project.name);
  const warnings: string[] = [];
  const outputs: ExportResult['outputs'] = [];
  const out = path.resolve(opts.outputDir);
  await fsp.mkdir(out, { recursive: true });
  const staging = path.join(out, `.${name}-game`);
  await fsp.rm(staging, { recursive: true, force: true });
  warnings.push(...(await buildGameFolder(ctx, projectDir, project, staging, opts)));

  for (const target of opts.targets) {
    if (target === 'web') {
      const dir = path.join(out, `${name}-web`);
      await removeOutputDir(dir, MARKER);
      await copyDir(staging, dir);
      await fsp.writeFile(path.join(dir, MARKER), 'web');
      outputs.push({ target, path: dir });
      ctx.log(`Web build: ${dir}`);
      continue;
    }
    const [os, arch] = target.split('-') as ['mac' | 'win', Arch];
    const platform: Platform = os === 'mac' ? 'darwin' : 'win32';
    const zip = await ctx.templates.ensure(platform, arch, ctx.log);
    const dir = path.join(out, `${name}-${target}`);
    await removeOutputDir(dir, MARKER);
    ctx.log(`Unpacking ${path.basename(zip)}…`);
    await extractZip(zip, dir);
    await fsp.writeFile(path.join(dir, MARKER), target);
    if (platform === 'darwin') {
      const app = await packageMac(ctx, dir, name, project, staging, opts);
      outputs.push({ target, path: app });
      ctx.log(`macOS app: ${app}`);
    } else {
      const exe = await packageWindows(ctx, dir, name, project, staging, opts);
      outputs.push({ target, path: exe });
      ctx.log(`Windows app: ${exe}`);
      if (opts.zipWindows !== false) {
        const zipOut = path.join(out, `${name}-${target}.zip`);
        await zipDir(dir, zipOut, `${name}/`);
        ctx.log(`Zipped: ${zipOut}`);
      }
    }
  }
  await fsp.rm(staging, { recursive: true, force: true });
  return { outputs, warnings };
}

async function writeAppFolder(ctx: ExportContext, appDir: string, name: string, project: Project, staging: string): Promise<void> {
  await fsp.mkdir(appDir, { recursive: true });
  await fsp.copyFile(path.join(ctx.playerShellDir, 'main.js'), path.join(appDir, 'main.js'));
  await fsp.copyFile(path.join(ctx.playerShellDir, 'preload.js'), path.join(appDir, 'preload.js'));
  await atomicWrite(path.join(appDir, 'package.json'), JSON.stringify({ name: project.settings.identifier || 'vne-game', productName: name, version: project.settings.version || '1.0.0', main: 'main.js', private: true }, null, 2));
  await copyDir(staging, path.join(appDir, 'game'));
}

async function packageMac(ctx: ExportContext, dir: string, name: string, project: Project, staging: string, opts: ExportOptions): Promise<string> {
  const src = path.join(dir, 'Electron.app');
  if (!(await exists(src))) throw new Error('The macOS runtime template does not contain Electron.app');
  const app = path.join(dir, `${name}.app`);
  await fsp.rename(src, app);
  const res = path.join(app, 'Contents', 'Resources');
  await fsp.rm(path.join(res, 'default_app.asar'), { force: true });
  await writeAppFolder(ctx, path.join(res, 'app'), name, project, staging);
  const plistPath = path.join(app, 'Contents', 'Info.plist');
  let plist = await fsp.readFile(plistPath, 'utf8');
  const v = project.settings.version || '1.0.0';
  plist = setPlist(plist, 'CFBundleDisplayName', name);
  plist = setPlist(plist, 'CFBundleName', name.slice(0, 15));
  plist = setPlist(plist, 'CFBundleIdentifier', project.settings.identifier || 'com.example.game');
  plist = setPlist(plist, 'CFBundleShortVersionString', v);
  plist = setPlist(plist, 'CFBundleVersion', v);
  await fsp.writeFile(plistPath, plist);
  if (opts.icons) {
    const icns = buildIcns(opts.icons);
    if (icns) await fsp.writeFile(path.join(res, 'electron.icns'), icns);
  }
  // LICENSE and LICENSES.chromium.html stay next to the app: Electron's license requires shipping them.
  if (process.platform === 'darwin') {
    ctx.log('Signing the app (ad-hoc)…');
    await run('xattr', ['-cr', app]).catch(() => {});
    await run('codesign', ['--force', '--deep', '--sign', '-', app]).catch((err) => ctx.log(`codesign failed: ${err.message}. The app may need "xattr -cr" before first launch.`));
  } else {
    ctx.log('Note: built on a non-Mac system. On the Mac, run: codesign --force --deep --sign - "<App>.app" (see docs/user-guide/export.md).');
  }
  return app;
}

async function packageWindows(ctx: ExportContext, dir: string, name: string, project: Project, staging: string, opts: ExportOptions): Promise<string> {
  const exeSrc = path.join(dir, 'electron.exe');
  if (!(await exists(exeSrc))) throw new Error('The Windows runtime template does not contain electron.exe');
  const exe = path.join(dir, `${name}.exe`);
  await fsp.rename(exeSrc, exe);
  await fsp.rm(path.join(dir, 'resources', 'default_app.asar'), { force: true });
  await writeAppFolder(ctx, path.join(dir, 'resources', 'app'), name, project, staging);
  if (opts.icons) {
    const ico = buildIco(opts.icons);
    if (ico) await fsp.writeFile(path.join(dir, 'resources', 'app', 'game', 'icon.ico'), ico);
  }
  return exe;
}

function setPlist(plist: string, key: string, value: string): string {
  const esc = escapeHtml(value);
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
  if (re.test(plist)) return plist.replace(re, `$1${esc}$3`);
  return plist.replace('</dict>', `\t<key>${key}</key>\n\t<string>${esc}</string>\n</dict>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ICNS with embedded PNG images (supported by macOS 10.7+). */
export function buildIcns(icons: Record<number, string>): Buffer | null {
  const types: [string, number][] = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const parts: Buffer[] = [];
  for (const [type, size] of types) {
    const b64 = icons[size];
    if (!b64) continue;
    const png = Buffer.from(b64, 'base64');
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    parts.push(head, png);
  }
  if (!parts.length) return null;
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** ICO with embedded PNG images (Windows Vista+). */
export function buildIco(icons: Record<number, string>): Buffer | null {
  const sizes = [16, 24, 32, 48, 64, 128, 256].filter((s) => icons[s]);
  if (!sizes.length) return null;
  const pngs = sizes.map((s) => Buffer.from(icons[s], 'base64'));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + dir.length;
  sizes.forEach((s, i) => {
    const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o);
    dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(pngs[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(cmd, args, (err) => (err ? reject(err) : resolve())));
}
