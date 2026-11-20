import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { exists } from './fsutil';

/** Electron version used for exported games. Keep in sync with package.json devDependencies. */
export const ELECTRON_VERSION = '45.4.1';

export type Platform = 'darwin' | 'win32' | 'linux';
export type Arch = 'x64' | 'arm64';

export function templateName(platform: Platform, arch: Arch, version = ELECTRON_VERSION): string {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

/**
 * Electron runtime zips are looked up, in order, in:
 *  1. folders passed in `searchDirs` (the packaged editor ships them in resources/runtime-templates),
 *  2. the user cache (~/.vne/runtime-templates),
 * and are downloaded from the official GitHub release (with SHA-256 verification) only when missing.
 */
export class TemplateStore {
  constructor(readonly cacheDir: string, readonly searchDirs: string[] = []) {}

  async find(platform: Platform, arch: Arch, version = ELECTRON_VERSION): Promise<string | null> {
    const name = templateName(platform, arch, version);
    for (const d of [...this.searchDirs, this.cacheDir]) {
      const p = path.join(d, name);
      if (await exists(p)) return p;
    }
    return null;
  }

  async status(version = ELECTRON_VERSION): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const [p, a] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']] as [Platform, Arch][]) out[`${p}-${a}`] = await this.find(p, a, version);
    return out;
  }

  async ensure(platform: Platform, arch: Arch, log: (m: string) => void, version = ELECTRON_VERSION): Promise<string> {
    const found = await this.find(platform, arch, version);
    if (found) return found;
    const name = templateName(platform, arch, version);
    const base = `https://github.com/electron/electron/releases/download/v${version}`;
    await fsp.mkdir(this.cacheDir, { recursive: true });
    log(`Downloading ${name} (first export for this platform)…`);
    const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
    const line = sums.split('\n').find((l) => l.trim().endsWith(name));
    if (!line) throw new Error(`No checksum for ${name}`);
    const expected = line.trim().split(/\s+/)[0];
    const tmp = path.join(this.cacheDir, `${name}.part`);
    await downloadToFile(`${base}/${name}`, tmp, (pct) => log(`Downloading ${name}: ${pct}%`));
    const actual = await sha256(tmp);
    if (actual !== expected) { await fsp.rm(tmp, { force: true }); throw new Error(`Checksum mismatch for ${name}`); }
    const dest = path.join(this.cacheDir, name);
    await fsp.rename(tmp, dest);
    log(`Verified ${name}`);
    return dest;
  }
}

function get(url: string, redirects = 5): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'visual-novel-editor' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      resolve(res);
    }).on('error', reject);
  });
}

async function download(url: string): Promise<Buffer> {
  const res = await get(url);
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function downloadToFile(url: string, file: string, progress: (pct: number) => void): Promise<void> {
  const res = await get(url);
  const total = Number(res.headers['content-length'] || 0);
  let got = 0;
  let lastPct = -10;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file);
    res.on('data', (c: Buffer) => {
      got += c.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct >= lastPct + 10) { lastPct = pct; progress(pct); }
    });
    res.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    res.on('error', reject);
  });
}

async function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
