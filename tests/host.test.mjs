import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync, utimesSync, readlinkSync, lstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as V from '../dist/test/vne.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'vne-host-'));

test('zip write / list / extract round trip, including symlinks and modes', async () => {
  const dir = tmp();
  const z = path.join(dir, 'a.zip');
  await V.zip.writeZip(z, [
    { name: 'a/hello.txt', data: Buffer.from('hello') },
    { name: 'a/bin/run', data: Buffer.from('#!/bin/sh\necho hi\n'), mode: 0o755 },
    { name: 'a/link', symlink: 'hello.txt' },
  ]);
  assert.deepEqual((await V.zip.listZip(z)).sort(), ['a/bin/run', 'a/hello.txt', 'a/link']);
  assert.equal((await V.zip.readZipFile(z, 'a/hello.txt')).toString(), 'hello');
  const out = path.join(dir, 'out');
  await V.zip.extractZip(z, out);
  assert.equal(readFileSync(path.join(out, 'a/hello.txt'), 'utf8'), 'hello');
  assert.ok(lstatSync(path.join(out, 'a/link')).isSymbolicLink());
  assert.equal(readlinkSync(path.join(out, 'a/link')), 'hello.txt');
  if (process.platform !== 'win32') assert.equal(statSync(path.join(out, 'a/bin/run')).mode & 0o111, 0o111);
  // The system unzip agrees with our writer.
  try { execFileSync('unzip', ['-tq', z]); } catch (err) { if (err.code !== 'ENOENT') throw err; }
});

test('zip extraction refuses paths that escape the destination', async () => {
  const dir = tmp();
  const z = path.join(dir, 'evil.zip');
  await V.zip.writeZip(z, [{ name: '../escape.txt', data: Buffer.from('x') }]);
  await assert.rejects(V.zip.extractZip(z, path.join(dir, 'out')));
  assert.equal(existsSync(path.join(dir, 'escape.txt')), false);
});

test('save keeps backups; newer autosave is offered for recovery; damaged file falls back to a backup', async () => {
  const dir = path.join(tmp(), 'Story');
  const p = V.createProject('Story');
  await V.projects.createProjectFolder(dir, V.serializeProject(p));
  const p2 = V.produce(p, (d) => { d.name = 'Story 2'; });
  await V.projects.saveProjectFile(dir, V.serializeProject(p2));
  assert.ok(existsSync(path.join(dir, '.vne/backups')));
  // Autosave newer than the project file → recovery.
  const p3 = V.produce(p2, (d) => { d.name = 'Unsaved'; });
  await V.projects.writeAutosave(dir, V.serializeProject(p3));
  const future = new Date(Date.now() + 10_000);
  utimesSync(path.join(dir, '.vne/autosave.json'), future, future);
  const opened = await V.projects.openProjectFolder(dir);
  assert.equal(JSON.parse(opened.recovery.json).name, 'Unsaved');
  // Damaged main file → newest backup.
  writeFileSync(path.join(dir, 'project.vne.json'), '{ broken');
  const rescued = await V.projects.openProjectFolder(dir);
  assert.equal(JSON.parse(rescued.json).format, 'vne.project');
});

test('asset import de-duplicates identical files and detects missing ones', async () => {
  const dir = tmp();
  const src = path.join(dir, 'src');
  mkdirSync(src);
  const png = readFileSync(path.join(root, 'resources/icons/app.png'));
  writeFileSync(path.join(src, 'a.png'), png);
  writeFileSync(path.join(src, 'b.png'), png);
  const proj = path.join(dir, 'proj');
  mkdirSync(proj);
  const r = await V.importAssets(proj, [{ name: 'a.png', sourcePath: path.join(src, 'a.png') }, { name: 'b.png', sourcePath: path.join(src, 'b.png') }], []);
  assert.equal(r.assets.length, 1, JSON.stringify(r.errors));
  assert.equal(r.reused.length, 1);
  assert.equal(r.assets[0].kind, 'image');
  assert.equal(r.assets[0].meta.width, 512);
  assert.deepEqual(await V.missingAssets(proj, r.assets), []);
  assert.deepEqual(await V.missingAssets(proj, [{ ...r.assets[0], id: 'gone', path: 'assets/images/nope.png' }]), ['gone']);
});

async function mockTemplates(dir) {
  const plist = '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Electron</string><key>CFBundleIdentifier</key><string>com.github.Electron</string></dict></plist>';
  await V.zip.writeZip(path.join(dir, V.templateName('darwin', 'arm64')), [
    { name: 'Electron.app/Contents/Info.plist', data: Buffer.from(plist) },
    { name: 'Electron.app/Contents/MacOS/Electron', data: Buffer.from('bin'), mode: 0o755 },
    { name: 'Electron.app/Contents/Resources/default_app.asar', data: Buffer.from('asar') },
    { name: 'Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework', data: Buffer.from('fw') },
    { name: 'Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/Current', symlink: 'A' },
    { name: 'LICENSE', data: Buffer.from('MIT') },
  ]);
  await V.zip.writeZip(path.join(dir, V.templateName('win32', 'x64')), [
    { name: 'electron.exe', data: Buffer.from('MZ') },
    { name: 'resources/default_app.asar', data: Buffer.from('asar') },
    { name: 'LICENSE', data: Buffer.from('MIT') },
  ]);
}

test('export: web, macOS and Windows packages from the example game (mock runtime templates)', async () => {
  const dir = tmp();
  const tpl = path.join(dir, 'templates');
  mkdirSync(tpl);
  await mockTemplates(tpl);
  const game = path.join(root, 'examples/games/like-human');
  const project = V.loadProject(readFileSync(path.join(game, 'project.vne.json'), 'utf8')).project;
  const png = readFileSync(path.join(root, 'resources/icons/app.png')).toString('base64');
  const logs = [];
  const ctx = {
    playerDir: path.join(root, 'dist/player'), playerShellDir: path.join(root, 'dist/player-shell'),
    modules: new V.ModuleStore(path.join(dir, 'lib'), [path.join(root, 'examples/extensions')]),
    templates: new V.TemplateStore(path.join(dir, 'cache'), [tpl]), log: (m) => logs.push(m),
  };
  const out = path.join(dir, 'out');
  const r = await V.exporter.exportGame(ctx, game, project, { outputDir: out, targets: ['web', 'mac-arm64', 'win-x64'], icons: { 16: png, 32: png, 128: png, 256: png, 512: png }, zipWindows: true });
  assert.equal(r.outputs.length, 3);
  const web = path.join(out, 'Like Human-web');
  for (const f of ['index.html', 'player.js', 'game.js', 'config.json', 'icon.png']) assert.ok(existsSync(path.join(web, f)), f);
  const gameJs = readFileSync(path.join(web, 'game.js'), 'utf8');
  assert.ok(!gameJs.includes('"editor":'), 'editor-only project data is stripped');
  // Only runtime parts of modules are shipped.
  assert.ok(existsSync(path.join(web, 'modules/com.example.relationships/runtime.js')));
  assert.equal(existsSync(path.join(web, 'modules/com.example.relationships/editor.js')), false);
  // Only used assets are copied.
  assert.ok(existsSync(path.join(web, 'assets/images/bg_lab.png')));
  const app = path.join(out, 'Like Human-mac-arm64', 'Like Human.app');
  const plist = readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleIdentifier<\/key><string>com\.example\.likehuman<\/string>/);
  assert.match(plist, /CFBundleDisplayName/);
  assert.ok(existsSync(path.join(app, 'Contents/Resources/app/game/game.js')));
  assert.ok(existsSync(path.join(app, 'Contents/Resources/app/main.js')));
  assert.ok(existsSync(path.join(app, 'Contents/Resources/electron.icns')));
  assert.equal(existsSync(path.join(app, 'Contents/Resources/default_app.asar')), false);
  assert.ok(lstatSync(path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/Current')).isSymbolicLink());
  const win = path.join(out, 'Like Human-win-x64');
  assert.ok(existsSync(path.join(win, 'Like Human.exe')));
  assert.ok(existsSync(path.join(win, 'resources/app/game/icon.ico')));
  assert.ok(existsSync(path.join(out, 'Like Human-win-x64.zip')));
  // Exporting again replaces the previous output safely.
  await V.exporter.exportGame(ctx, game, project, { outputDir: out, targets: ['web'] });
  assert.ok(existsSync(path.join(web, 'index.html')));
});

test('pack-module output installs through the module store', async () => {
  const dir = tmp();
  execFileSync(process.execPath, [path.join(root, 'scripts/pack-module.mjs'), path.join(root, 'templates/extension'), '--out', dir]);
  const file = path.join(dir, 'com.yourname.my-module-0.1.0.vnemod');
  assert.ok(existsSync(file));
  const store = new V.ModuleStore(path.join(dir, 'lib'));
  const proj = path.join(dir, 'proj');
  mkdirSync(proj);
  const m = await store.install(file, 'project', proj);
  assert.equal(m.manifest.id, 'com.yourname.my-module');
  assert.ok(existsSync(path.join(proj, 'modules/com.yourname.my-module/runtime.js')));
  assert.equal((await store.list(proj)).find((x) => x.manifest.id === 'com.yourname.my-module').scope, 'project');
});

test('packaged app: examples open as a personal copy, bundled modules are listed', async () => {
  const dir = tmp();
  const mk = (ro) => V.createHost({ mode: 'electron', distDir: path.join(root, 'dist'), examplesDir: path.join(root, 'examples'), userDataDir: path.join(dir, ro ? 'ud-ro' : 'ud'), urlBase: 'vne-fs://fs/', examplesReadOnly: ro });
  const ro = mk(true);
  const info = await ro.methods.info();
  assert.equal(info.examplesReadOnly, true);
  const a = await ro.methods['examples.workingCopy']({ id: 'like-human' });
  assert.equal(a.path, path.join(dir, 'ud-ro', 'examples', 'like-human'));
  assert.ok(existsSync(path.join(a.path, 'project.vne.json')));
  assert.ok(existsSync(path.join(a.path, 'modules', 'com.example.timed-choices', 'runtime.js')), 'project modules are copied');
  // Second open reuses the copy (keeps the user's changes).
  writeFileSync(path.join(a.path, 'marker.txt'), 'x');
  const b = await ro.methods['examples.workingCopy']({ id: 'like-human' });
  assert.equal(b.path, a.path);
  assert.ok(existsSync(path.join(b.path, 'marker.txt')));
  // From source, the example itself is opened.
  const rw = mk(false);
  assert.equal((await rw.methods['examples.workingCopy']({ id: 'like-human' })).path, path.join(root, 'examples', 'games', 'like-human'));
  // Every bundled example module is listed and compatible, for the copy too.
  const mods = await ro.methods['modules.list']({ path: a.path });
  const ids = new Set(mods.map((m) => m.manifest.id));
  for (const id of ['com.example.relationships', 'com.example.timed-choices', 'com.example.speech-bubble', 'com.example.wobble', 'com.example.retro-fx', 'com.example.extra-blocks', 'com.example.dice-check']) assert.ok(ids.has(id), id);
  assert.ok(mods.every((m) => m.compatible), JSON.stringify(mods.filter((m) => !m.compatible).map((m) => [m.manifest.id, m.problems])));
});

test('effect preset library: save, list, export, import, delete', async () => {
  const dir = tmp();
  const host = V.createHost({ mode: 'electron', distDir: path.join(root, 'dist'), examplesDir: path.join(root, 'examples'), userDataDir: path.join(dir, 'ud'), urlBase: 'vne-fs://fs/' });
  const p = V.createProject('P');
  const preset = V.presetFromEffect(p, { kind: 'inline', graph: { id: 'g', name: 'Blur', params: [], nodes: [{ id: 'a', type: 'fx.input', x: 0, y: 0, values: {} }, { id: 'b', type: 'fx.output', x: 1, y: 0, values: {} }], edges: [] } }, 'Soft / blur');
  assert.deepEqual(await host.methods['effectPresets.list'](), []);
  await host.methods['effectPresets.save']({ preset });
  let list = await host.methods['effectPresets.list']();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Soft / blur');
  const out = path.join(dir, 'out'); mkdirSync(out);
  const { path: file } = await host.methods['effectPresets.export']({ id: preset.id, dir: out });
  assert.ok(file.endsWith('.vnefx') && !path.basename(file).includes('/'));
  // A second export does not overwrite the first.
  const { path: file2 } = await host.methods['effectPresets.export']({ id: preset.id, dir: out });
  assert.notEqual(file, file2);
  await host.methods['effectPresets.delete']({ id: preset.id });
  assert.equal((await host.methods['effectPresets.list']()).length, 0);
  writeFileSync(path.join(out, 'bad.vnefx'), '{"format":"x"}');
  const r = await host.methods['effectPresets.import']({ paths: [file, path.join(out, 'bad.vnefx')] });
  assert.equal(r.imported.length, 1);
  assert.equal(r.errors.length, 1);
  list = await host.methods['effectPresets.list']();
  assert.equal(list[0].id, preset.id);
  await assert.rejects(() => host.methods['effectPresets.delete']({ id: '../x' }), /Invalid preset id/);
});
