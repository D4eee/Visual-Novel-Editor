#!/usr/bin/env node
/**
 * Downloads the Electron runtime zips used as templates for exported games and
 * verifies them against Electron's published SHA256 checksums.
 *
 *   node scripts/fetch-runtime-templates.mjs           # all export targets (macOS arm64 + x64, Windows x64)
 *   node scripts/fetch-runtime-templates.mjs --host    # only the current platform
 *   node scripts/fetch-runtime-templates.mjs --none    # nothing (the editor downloads on first export)
 *
 * Files go to resources/runtime-templates/, which `npm run dist` ships inside the
 * editor so exporting works offline. Already-downloaded, verified files are reused,
 * and so is Electron's own download cache (~/.cache/electron, ~/Library/Caches/electron,
 * %LOCALAPPDATA%\electron\Cache) when it has the same file.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, copyFile, readdir } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
// Same Electron version as exported games (packages/host/src/templates.ts).
const tplSrc = await readFile(path.join(root, 'packages', 'host', 'src', 'templates.ts'), 'utf8').catch(() => '');
const version = (tplSrc.match(/ELECTRON_VERSION = '([\d.]+)'/) || [])[1] || String(pkg.devDependencies?.electron || '').replace(/^[^\d]*/, '');
const outDir = path.join(root, 'resources', 'runtime-templates');
const args = process.argv.slice(2);

const ALL = [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']];
let targets = ALL;
if (args.includes('--none')) targets = [];
else if (args.includes('--host')) targets = ALL.filter(([p, a]) => p === process.platform && a === process.arch);

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'visual-novel-editor' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); resolve(get(new URL(res.headers.location, url).href, redirects - 1)); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      resolve(res);
    }).on('error', reject);
  });
}

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

function electronCacheDirs() {
  const home = os.homedir();
  return [process.env.electron_config_cache, path.join(home, '.cache', 'electron'), path.join(home, 'Library', 'Caches', 'electron'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'electron', 'Cache')].filter(Boolean);
}

async function findInCache(name) {
  for (const dir of electronCacheDirs()) {
    if (!existsSync(dir)) continue;
    if (existsSync(path.join(dir, name))) return path.join(dir, name);
    // Electron's cache stores files in hashed sub-folders.
    for (const sub of await readdir(dir).catch(() => [])) if (existsSync(path.join(dir, sub, name))) return path.join(dir, sub, name);
  }
  return null;
}

async function main() {
  if (!targets.length) { console.log('No runtime templates requested.'); return; }
  await mkdir(outDir, { recursive: true });
  const base = `https://github.com/electron/electron/releases/download/v${version}`;
  console.log(`Electron ${version}: fetching checksums…`);
  const res = await get(`${base}/SHASUMS256.txt`);
  let sums = '';
  for await (const c of res) sums += c;
  for (const [platform, arch] of targets) {
    const name = `electron-v${version}-${platform}-${arch}.zip`;
    const line = sums.split('\n').find((l) => l.trim().endsWith(`*${name}`) || l.trim().endsWith(` ${name}`));
    if (!line) throw new Error(`No checksum for ${name}`);
    const expected = line.trim().split(/\s+/)[0];
    const dest = path.join(outDir, name);
    if (existsSync(dest) && (await sha256(dest)) === expected) { console.log(`✓ ${name} (already present)`); continue; }
    const cached = await findInCache(name);
    if (cached && (await sha256(cached)) === expected) { await copyFile(cached, dest); console.log(`✓ ${name} (from Electron cache)`); continue; }
    const tmp = `${dest}.part`;
    process.stdout.write(`↓ ${name} `);
    const r = await get(`${base}/${name}`);
    const total = Number(r.headers['content-length'] || 0);
    let got = 0, last = -10;
    await new Promise((resolve, reject) => {
      const out = createWriteStream(tmp);
      r.on('data', (c) => { got += c.length; const pct = total ? Math.floor((got / total) * 100) : 0; if (pct >= last + 10) { last = pct; process.stdout.write(`${pct}% `); } });
      r.pipe(out);
      out.on('finish', resolve); out.on('error', reject); r.on('error', reject);
    });
    process.stdout.write('\n');
    const actual = await sha256(tmp);
    if (actual !== expected) { await rm(tmp, { force: true }); throw new Error(`Checksum mismatch for ${name}`); }
    await rename(tmp, dest);
    console.log(`✓ ${name} verified`);
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
