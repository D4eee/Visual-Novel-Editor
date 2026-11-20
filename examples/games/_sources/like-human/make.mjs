#!/usr/bin/env node
/**
 * Rebuilds the "Like Human" example game in examples/games/like-human:
 *   1. renders images (make_images.py — needs rsvg-convert),
 *   2. renders audio and video (make_media.py — needs numpy, Pillow and ffmpeg),
 *   3. copies the example modules it uses into the project's modules/ folder,
 *   4. writes project.vne.json from build-project.ts and validates it.
 *
 *   node examples/games/_sources/like-human/make.mjs [--skip-media]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const game = path.join(root, 'examples/games/like-human');
const tmp = path.join(root, 'dist/.like-human-build');
const skipMedia = process.argv.includes('--skip-media');

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const sub of ['assets/images', 'assets/audio', 'assets/video', 'assets/fonts', 'modules', '.vne']) mkdirSync(path.join(game, sub), { recursive: true });

if (!skipMedia) {
  execFileSync('python3', [path.join(here, 'make_images.py'), path.join(tmp, 'img')], { stdio: 'inherit' });
  execFileSync('python3', [path.join(here, 'make_media.py'), path.join(tmp, 'media')], { stdio: 'inherit' });
  const move = (from, to, filter) => { for (const f of readdirSync(from)) if (filter(f)) renameSync(path.join(from, f), path.join(game, to, f)); };
  move(path.join(tmp, 'img'), 'assets/images', (f) => f.endsWith('.png'));
  move(path.join(tmp, 'media'), 'assets/audio', (f) => f.endsWith('.ogg'));
  move(path.join(tmp, 'media'), 'assets/video', (f) => f.endsWith('.webm'));
}

const modules = ['relationships', 'timed-choices', 'speech-bubble', 'wobble', 'retro-fx', 'extra-blocks', 'dice-check'];
for (const m of modules) {
  const id = `com.example.${m}`;
  const dest = path.join(game, 'modules', id);
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(root, 'examples/extensions', m), dest, { recursive: true, filter: (src) => !src.endsWith('README.md') });
}

const esbuild = await import(path.join(root, 'node_modules/esbuild/lib/main.js'));
const out = path.join(tmp, 'build-project.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'build-project.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', target: 'node20',
  alias: { '@vne/core': path.join(root, 'packages/core/src/index.ts'), '@vne/runtime': path.join(root, 'packages/runtime/src/index.ts') },
  // The runtime touches `document` only when a game runs; nothing here renders.
  banner: { js: "globalThis.document ??= undefined; globalThis.localStorage ??= undefined;" },
});
execFileSync(process.execPath, [out, game], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (!existsSync(path.join(game, 'project.vne.json'))) process.exit(1);
