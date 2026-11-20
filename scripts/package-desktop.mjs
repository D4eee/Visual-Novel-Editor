#!/usr/bin/env node
/**
 * Packages the editor as a desktop application that runs without Node.js or a
 * terminal: "Visual Novel Editor.app" (macOS) or "Visual Novel Editor.exe" (Windows).
 *
 *   npm run app:mac                     # this Mac's architecture
 *   node scripts/package-desktop.mjs --target mac-arm64 --target mac-x64 --target win-x64 [--zip]
 *
 * Options
 *   --target <t>        mac-arm64 | mac-x64 | win-x64 | linux-x64 (repeatable; default: this computer)
 *   --electron-dir <d>  folder with electron-v<version>-<platform>-<arch>.zip (default: resources/runtime-templates)
 *   --out <d>           output folder (default: release/)
 *   --zip               also write <name>-<target>.zip next to each app (symlinks and permissions kept)
 *   --no-templates      do not bundle the runtime templates used to export games
 *
 * The layout matches electron-builder's (asar disabled):
 *   <resources>/app/{package.json, dist/…}   editor code
 *   <resources>/examples                     example games and example modules (loaded read-only)
 *   <resources>/sdk, <resources>/templates   module SDK and the new-module template
 *   <resources>/runtime-templates            Electron zips, so exporting games works offline
 * Run `npm run build` and `npm run fetch-runtimes` first. On a Mac the app is signed ad hoc.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile, copyFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronVersion = String(pkg.devDependencies.electron).replace(/^[^\d]*/, '');
const NAME = pkg.productName || 'Visual Novel Editor';
const APP_ID = pkg.build?.appId || 'io.github.d4eee.visual-novel-editor';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const all = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const hostTarget = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
const targets = all('--target').length ? all('--target') : [hostTarget];
const electronDir = path.resolve(opt('--electron-dir', path.join(root, 'resources', 'runtime-templates')));
const outDir = path.resolve(opt('--out', path.join(root, 'release')));
const withZip = args.includes('--zip');
const withTemplates = !args.includes('--no-templates');

const distDir = path.join(root, 'dist');
if (!existsSync(path.join(distDir, 'desktop', 'main.js')) || !existsSync(path.join(distDir, 'tools', 'zip.mjs'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}
const { extractZip, zipDir } = await import(path.join(distDir, 'tools', 'zip.mjs'));

const PLATFORM = { mac: 'darwin', win: 'win32', linux: 'linux' };
const run = (cmd, a) => new Promise((res, rej) => execFile(cmd, a, (err, out, se) => (err ? rej(new Error(se || err.message)) : res(out))));
const log = (m) => console.log(m);

/** Files of the editor itself (resources/app). */
async function writeAppCode(appDir) {
  await mkdir(appDir, { recursive: true });
  const skip = (rel) => rel.endsWith('.map') || rel.startsWith('test') || rel.startsWith('tools') || rel.startsWith('.') || rel === 'server.js' || rel.startsWith('server.');
  await cp(distDir, path.join(appDir, 'dist'), { recursive: true, filter: (src) => !skip(path.relative(distDir, src).split(path.sep).join('/')) || src === distDir });
  const appPkg = { name: pkg.name, productName: NAME, version: pkg.version, description: pkg.description, author: pkg.author, license: pkg.license, main: 'dist/desktop/main.js', private: true };
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify(appPkg, null, 2));
}

/** Example games/modules, SDK, module template and export templates (next to resources/app). */
async function writeExtraResources(res) {
  await cp(path.join(root, 'examples'), path.join(res, 'examples'), { recursive: true, filter: (src) => !src.includes(`${path.sep}_sources`) && !src.includes(`${path.sep}node_modules`) && !path.basename(src).startsWith('.DS_Store') });
  await mkdir(path.join(res, 'sdk'), { recursive: true });
  for (const p of ['dist', 'types', 'README.md']) if (existsSync(path.join(root, 'sdk', p))) await cp(path.join(root, 'sdk', p), path.join(res, 'sdk', p), { recursive: true });
  await cp(path.join(root, 'templates'), path.join(res, 'templates'), { recursive: true });
  await mkdir(path.join(res, 'runtime-templates'), { recursive: true });
  if (!withTemplates) return;
  const names = ['darwin-arm64', 'darwin-x64', 'win32-x64'].map((t) => `electron-v${electronVersion}-${t}.zip`);
  let n = 0;
  for (const f of names) {
    const src = path.join(electronDir, f);
    if (existsSync(src)) { await copyFile(src, path.join(res, 'runtime-templates', f)); n++; }
    else log(`  (export template ${f} not found: exporting for that platform will download it on first use)`);
  }
  log(`  bundled ${n} export template(s)`);
}

function setPlist(plist, key, value) {
  const esc = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
  return re.test(plist) ? plist.replace(re, `$1${esc}$3`) : plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t<string>${esc}</string>\n</dict>\n</plist>\n`);
}

const DOC_TYPES = `\t<key>CFBundleDocumentTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleTypeExtensions</key>
\t\t\t<array><string>vne</string></array>
\t\t\t<key>CFBundleTypeName</key>
\t\t\t<string>Visual Novel Project</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Editor</string>
\t\t</dict>
\t</array>
`;

async function packageTarget(target) {
  const [os, arch] = target.split('-');
  const platform = PLATFORM[os];
  if (!platform || !arch) throw new Error(`Unknown target "${target}"`);
  const zip = path.join(electronDir, `electron-v${electronVersion}-${platform}-${arch}.zip`);
  if (!existsSync(zip)) throw new Error(`Missing ${zip}\nRun: node scripts/fetch-runtime-templates.mjs (or pass --electron-dir)`);
  const dir = path.join(outDir, `${NAME}-${target}`);
  await rm(dir, { recursive: true, force: true });
  log(`${target}: unpacking Electron ${electronVersion}…`);
  await extractZip(zip, dir);
  let result;
  if (os === 'mac') {
    const app = path.join(dir, `${NAME}.app`);
    await rename(path.join(dir, 'Electron.app'), app);
    const contents = path.join(app, 'Contents');
    // A renamed executable makes app.isPackaged true (the editor then reads examples etc. from Resources).
    await rename(path.join(contents, 'MacOS', 'Electron'), path.join(contents, 'MacOS', NAME));
    const res = path.join(contents, 'Resources');
    await rm(path.join(res, 'default_app.asar'), { force: true });
    await writeAppCode(path.join(res, 'app'));
    await writeExtraResources(res);
    await copyFile(path.join(root, 'resources', 'icons', 'app.icns'), path.join(res, 'app.icns'));
    let plist = await readFile(path.join(contents, 'Info.plist'), 'utf8');
    for (const [k, v] of Object.entries({ CFBundleExecutable: NAME, CFBundleName: NAME.slice(0, 15), CFBundleDisplayName: NAME, CFBundleIdentifier: APP_ID, CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version, CFBundleIconFile: 'app.icns', LSApplicationCategoryType: 'public.app-category.developer-tools' })) plist = setPlist(plist, k, v);
    if (!plist.includes('CFBundleDocumentTypes')) plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${DOC_TYPES}</dict>\n</plist>\n`);
    await writeFile(path.join(contents, 'Info.plist'), plist);
    if (process.platform === 'darwin') {
      log('  signing (ad hoc)…');
      await run('xattr', ['-cr', app]).catch(() => {});
      await run('codesign', ['--force', '--deep', '--sign', '-', app]);
    }
    result = app;
  } else if (os === 'win') {
    await rename(path.join(dir, 'electron.exe'), path.join(dir, `${NAME}.exe`));
    const res = path.join(dir, 'resources');
    await rm(path.join(res, 'default_app.asar'), { force: true });
    await writeAppCode(path.join(res, 'app'));
    await writeExtraResources(res);
    result = path.join(dir, `${NAME}.exe`);
  } else {
    const exe = path.join(dir, 'visual-novel-editor');
    await rename(path.join(dir, 'electron'), exe);
    const res = path.join(dir, 'resources');
    await rm(path.join(res, 'default_app.asar'), { force: true });
    await writeAppCode(path.join(res, 'app'));
    await writeExtraResources(res);
    result = exe;
  }
  log(`  → ${result}`);
  if (withZip) {
    const out = path.join(outDir, `${NAME.replace(/\s+/g, '-')}-${pkg.version}-${target}.zip`);
    await rm(out, { force: true });
    await zipDir(dir, out);
    log(`  → ${out} (${((await stat(out)).size / 1048576).toFixed(0)} MB)`);
  }
  return result;
}

await mkdir(outDir, { recursive: true });
for (const t of targets) await packageTarget(t);
if (process.platform !== 'darwin' && targets.some((t) => t.startsWith('mac'))) {
  log('\nBuilt on a non-Mac system: before the first launch on the Mac, run once:');
  log(`  xattr -cr "${NAME}.app" && codesign --force --deep --sign - "${NAME}.app"`);
}
