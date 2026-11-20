#!/usr/bin/env node
/**
 * Builds every part of the engine with esbuild:
 *   dist/editor/        editor UI (index.html, editor.js, editor.css)
 *   dist/player/        game runtime bundle used by exported games
 *   dist/desktop/       Electron main + preload for the editor
 *   dist/player-shell/  Electron main + preload for exported games
 *   dist/server.js      browser-mode host (npm run serve)
 *   dist/tools/         zip helpers used by the packaging scripts
 *   sdk/dist/           public SDK helpers and typings for module authors
 *
 * Usage: node scripts/build.mjs [--watch] [--dev]
 */
import * as esbuild from 'esbuild';
import { mkdir, writeFile, copyFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const alias = {
  '@vne/core': path.join(root, 'packages/core/src/index.ts'),
  '@vne/runtime': path.join(root, 'packages/runtime/src/index.ts'),
  '@vne/sdk': path.join(root, 'sdk/src/index.ts'),
};

const common = {
  bundle: true,
  sourcemap: dev ? 'inline' : 'linked',
  minify: !dev,
  logLevel: 'info',
  alias,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  legalComments: 'linked',
};

const builds = [
  { ...common, entryPoints: { editor: path.join(root, 'packages/editor/src/main.tsx') }, outdir: path.join(dist, 'editor'), format: 'esm', platform: 'browser', target: ['chrome120'], jsx: 'automatic', loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl' } },
  { ...common, entryPoints: { player: path.join(root, 'packages/runtime/src/player.ts') }, outdir: path.join(dist, 'player'), format: 'iife', platform: 'browser', target: ['chrome110', 'safari16', 'firefox115'] },
  { ...common, entryPoints: { main: path.join(root, 'packages/desktop/src/main.ts'), preload: path.join(root, 'packages/desktop/src/preload.ts') }, outdir: path.join(dist, 'desktop'), format: 'cjs', platform: 'node', target: ['node20'], external: ['electron'] },
  { ...common, entryPoints: { main: path.join(root, 'packages/desktop/src/player-main.ts'), preload: path.join(root, 'packages/desktop/src/player-preload.ts') }, outdir: path.join(dist, 'player-shell'), format: 'cjs', platform: 'node', target: ['node20'], external: ['electron'], minify: true, sourcemap: false },
  { ...common, entryPoints: { server: path.join(root, 'packages/host/src/server.ts') }, outdir: dist, format: 'cjs', platform: 'node', target: ['node20'] },
  // Zip helpers for the packaging scripts (scripts/package-*.mjs).
  { ...common, entryPoints: { zip: path.join(root, 'packages/host/src/zip.ts') }, outdir: path.join(dist, 'tools'), format: 'esm', platform: 'node', target: ['node20'], minify: false, sourcemap: false, outExtension: { '.js': '.mjs' } },
  // Test bundle (node --test tests/): the source packages as one ES module.
  { ...common, entryPoints: { vne: path.join(root, 'tests/lib.ts') }, outdir: path.join(dist, 'test'), format: 'esm', platform: 'node', target: ['node20'], minify: false, sourcemap: false, outExtension: { '.js': '.mjs' }, banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } },
  { ...common, entryPoints: { index: path.join(root, 'sdk/src/index.ts') }, outdir: path.join(root, 'sdk/dist'), format: 'esm', platform: 'neutral', target: ['es2022'], minify: false, sourcemap: false, bundle: true },
];

async function writeHtml() {
  await mkdir(path.join(dist, 'editor'), { recursive: true });
  await writeFile(path.join(dist, 'editor', 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' vne-fs: vne-app: http://127.0.0.1:* data: blob:; script-src 'self' vne-fs: vne-app: http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' vne-fs: http://127.0.0.1:* data: blob:; media-src 'self' vne-fs: http://127.0.0.1:* data: blob:; font-src 'self' vne-fs: http://127.0.0.1:* data:; connect-src 'self' vne-fs: vne-app: http://127.0.0.1:* data: blob:">
<title>Visual Novel Editor</title>
<link rel="icon" href="./icon.png">
<link rel="stylesheet" href="./editor.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="./editor.js"></script>
</body>
</html>
`);
}

// Editions (branches `desktop` / `web`) leave out the entry points they do not use.
const present = (b) => Object.values(b.entryPoints).every((f) => existsSync(f));

async function main() {
  await mkdir(dist, { recursive: true });
  await writeHtml();
  await copyFile(path.join(root, 'resources/icons/app.png'), path.join(dist, 'editor', 'icon.png'));
  if (watch) {
    for (const b of builds.filter(present)) (await esbuild.context(b)).watch();
    console.log('Watching for changes…');
  } else {
    await Promise.all(builds.filter(present).map((b) => esbuild.build(b)));
    // Type declarations for module authors are hand-maintained in sdk/types.
    if (existsSync(path.join(root, 'sdk/types/index.d.ts'))) await copyFile(path.join(root, 'sdk/types/index.d.ts'), path.join(root, 'sdk/dist/index.d.ts'));
    // Keep the SDK copies used by example modules and the extension template in sync.
    const vendors = [path.join(root, 'templates/extension/vendor')];
    for (const name of await readdir(path.join(root, 'examples/extensions')).catch(() => [])) {
      const v = path.join(root, 'examples/extensions', name, 'vendor');
      if (existsSync(v)) vendors.push(v);
    }
    // …and the copies inside example game projects.
    for (const game of await readdir(path.join(root, 'examples/games')).catch(() => [])) {
      const mods = path.join(root, 'examples/games', game, 'modules');
      for (const name of await readdir(mods).catch(() => [])) if (existsSync(path.join(mods, name, 'vendor'))) vendors.push(path.join(mods, name, 'vendor'));
    }
    for (const v of vendors) if (existsSync(v)) {
      await copyFile(path.join(root, 'sdk/dist/index.js'), path.join(v, 'vne-sdk.js'));
      if (existsSync(path.join(v, 'vne-sdk.d.ts'))) await copyFile(path.join(root, 'sdk/types/index.d.ts'), path.join(v, 'vne-sdk.d.ts'));
    }
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    await writeFile(path.join(dist, 'build-info.json'), JSON.stringify({ version: pkg.version, built: new Date().toISOString() }, null, 2));
    console.log('Build complete.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
