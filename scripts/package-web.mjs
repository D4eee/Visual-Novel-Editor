#!/usr/bin/env node
/**
 * Packages the browser edition of the editor: a folder (and zip) that runs with
 * Node.js only — no npm install, no build. The editor opens in the web browser.
 *
 *   npm run app:web            # → release/Visual-Novel-Editor-<version>-web(.zip)
 *
 * Contents: dist/ (editor, game player, server), examples/, sdk/, templates/,
 * start scripts for macOS, Windows and Linux, and README.txt.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'release'));
const name = `Visual-Novel-Editor-${pkg.version}-web`;
const dest = path.join(outDir, name);
const dist = path.join(root, 'dist');
if (!existsSync(path.join(dist, 'server.js')) || !existsSync(path.join(dist, 'tools', 'zip.mjs'))) { console.error('Build first: npm run build'); process.exit(1); }
const { zipDir } = await import(path.join(dist, 'tools', 'zip.mjs'));

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
const skip = (rel) => rel.endsWith('.map') || rel.startsWith('test') || rel.startsWith('tools') || rel.startsWith('desktop') || rel.startsWith('.');
await cp(dist, path.join(dest, 'dist'), { recursive: true, filter: (src) => src === dist || !skip(path.relative(dist, src).split(path.sep).join('/')) });
await cp(path.join(root, 'examples'), path.join(dest, 'examples'), { recursive: true, filter: (src) => !src.includes(`${path.sep}_sources`) && !src.includes(`${path.sep}node_modules`) });
await mkdir(path.join(dest, 'sdk'), { recursive: true });
for (const p of ['dist', 'types', 'README.md']) if (existsSync(path.join(root, 'sdk', p))) await cp(path.join(root, 'sdk', p), path.join(dest, 'sdk', p), { recursive: true });
await cp(path.join(root, 'templates'), path.join(dest, 'templates'), { recursive: true });
await mkdir(path.join(dest, 'resources', 'runtime-templates'), { recursive: true });
await writeFile(path.join(dest, 'package.json'), JSON.stringify({ name: `${pkg.name}-web`, productName: `${pkg.productName} (Web)`, version: pkg.version, private: true, license: pkg.license, scripts: { start: 'node dist/server.js' }, engines: { node: '>=20' } }, null, 2));

const URL = 'http://127.0.0.1:5199';
const files = {
  'Start Visual Novel Editor.command': `#!/bin/bash
# macOS: double-click to start the editor in your web browser (Node.js 20+ required).
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 20 or newer is required: https://nodejs.org"; read -n 1; exit 1; fi
(sleep 1.5; open "${URL}") &
node dist/server.js
`,
  'start-windows.bat': `@echo off\r
rem Windows: double-click to start the editor in your web browser (Node.js 20+ required).\r
cd /d "%~dp0"\r
where node >nul 2>nul || (echo Node.js 20 or newer is required: https://nodejs.org & pause & exit /b 1)\r
start "" "${URL}"\r
node dist\\server.js\r
`,
  'start-linux.sh': `#!/bin/sh
# Linux: start the editor in your web browser (Node.js 20+ required).
cd "$(dirname "$0")"
(sleep 1.5; xdg-open "${URL}" >/dev/null 2>&1) &
exec node dist/server.js
`,
  'README.txt': `Visual Novel Editor ${pkg.version} — web edition

The editor runs in your web browser; a small local server (Node.js) gives it access
to your project folders. Nothing is uploaded anywhere.

Requirements: Node.js 20 or newer (https://nodejs.org). No npm install needed.

Start
  macOS    double-click "Start Visual Novel Editor.command"
           (first time: right-click → Open, or run: chmod +x *.command)
  Windows  double-click start-windows.bat
  Linux    ./start-linux.sh
  Any      node dist/server.js, then open ${URL}

Stop: close the terminal window (or press Ctrl+C in it).

Projects, settings and installed modules are stored in ~/.vne. Example games and
example modules are in examples/. Exporting web games works offline; exporting
macOS/Windows games downloads the Electron runtime (about 120-160 MB) the first time.

The desktop edition (Visual Novel Editor.app / .exe) needs no Node.js.
`,
};
for (const [f, text] of Object.entries(files)) {
  await writeFile(path.join(dest, f), text);
  if (!f.endsWith('.bat') && !f.endsWith('.txt')) await chmod(path.join(dest, f), 0o755);
}
console.log(`→ ${dest}`);
const zip = path.join(outDir, `${name}.zip`);
await rm(zip, { force: true });
await zipDir(dest, zip, `${name}/`);
console.log(`→ ${zip}`);
