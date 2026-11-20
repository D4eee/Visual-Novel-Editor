import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export async function exists(p: string): Promise<boolean> {
  try { await fsp.access(p); return true; } catch { return false; }
}

export async function isDir(p: string): Promise<boolean> {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}

/** Write via a temporary file + rename so a crash never leaves a half-written project. */
export async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

export async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

export async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

export async function copyDir(src: string, dest: string, filter?: (rel: string, isDir: boolean) => boolean, rel = ''): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  for (const ent of await fsp.readdir(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (filter && !filter(r, ent.isDirectory())) continue;
    if (ent.isSymbolicLink()) {
      const target = await fsp.readlink(s);
      await fsp.symlink(target, d).catch(() => {});
    } else if (ent.isDirectory()) await copyDir(s, d, filter, r);
    else await fsp.copyFile(s, d);
  }
}

/** Remove a directory, refusing anything that does not look like a build output we created. */
export async function removeOutputDir(dir: string, marker: string): Promise<void> {
  if (!(await exists(dir))) return;
  if (!(await exists(path.join(dir, marker)))) throw new Error(`Refusing to overwrite ${dir}: it was not created by the exporter. Choose an empty folder.`);
  await fsp.rm(dir, { recursive: true, force: true });
}

export function safeName(name: string, fallback = 'Game'): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Resolve `rel` under `root` and make sure it does not escape it. */
export function within(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const r = path.resolve(root);
  if (resolved !== r && !resolved.startsWith(r + path.sep)) throw new Error(`Path escapes its folder: ${rel}`);
  return resolved;
}

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm',
};

export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

export function kindOf(file: string): 'image' | 'audio' | 'video' | 'font' | 'other' {
  const m = mimeOf(file);
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('font/')) return 'font';
  return 'other';
}

/** Read image dimensions from the file header (PNG, JPEG, GIF, WebP, BMP, SVG). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.length > 26 && buf.toString('ascii', 0, 2) === 'BM') return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
    const head = buf.toString('utf8', 0, Math.min(buf.length, 2048));
    if (head.includes('<svg')) {
      const w = /\bwidth="([\d.]+)/.exec(head), h = /\bheight="([\d.]+)/.exec(head);
      if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
      const vb = /viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(head);
      if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
    }
  } catch { /* fall through */ }
  return null;
}
