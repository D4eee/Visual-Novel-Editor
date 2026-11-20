import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

/**
 * Minimal ZIP reader/writer (store + deflate, unix modes and symlinks).
 * Used for module packages (.vnemod) and Electron runtime templates, so the
 * editor does not depend on external archive tools.
 */

interface Entry { name: string; method: number; compSize: number; size: number; offset: number; externalAttr: number; madeBy: number }

function readEntries(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory)');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      count = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  const out: Entry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const madeBy = buf.readUInt16LE(p + 4);
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttr = buf.readUInt32LE(p + 38);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = buf.readUInt16LE(e), len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(buf.readBigUInt64LE(q)); }
      }
      e += 4 + len;
    }
    out.push({ name, method, compSize, size, offset, externalAttr, madeBy });
    p = extraEnd + commentLen;
  }
  return out;
}

function entryData(buf: Buffer, e: Entry): Buffer {
  const p = e.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`Corrupt local header for ${e.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported zip compression method ${e.method} in ${e.name}`);
}

export async function listZip(file: string): Promise<string[]> {
  return readEntries(await fsp.readFile(file)).map((e) => e.name);
}

export async function readZipFile(file: string, name: string): Promise<Buffer | null> {
  const buf = await fsp.readFile(file);
  const e = readEntries(buf).find((x) => x.name === name);
  return e ? entryData(buf, e) : null;
}

/** Extract a zip into `dest`, preserving unix permissions and symlinks. Rejects entries that escape `dest`. */
export async function extractZip(file: string, dest: string, opts: { stripPrefix?: string } = {}): Promise<number> {
  const buf = await fsp.readFile(file);
  const root = path.resolve(dest);
  await fsp.mkdir(root, { recursive: true });
  let n = 0;
  for (const e of readEntries(buf)) {
    let name = e.name.replace(/\\/g, '/');
    if (opts.stripPrefix) { if (!name.startsWith(opts.stripPrefix)) continue; name = name.slice(opts.stripPrefix.length); }
    if (!name || name.startsWith('__MACOSX/')) continue;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Unsafe path in zip: ${e.name}`);
    const unixMode = (e.madeBy >> 8) === 3 ? (e.externalAttr >>> 16) & 0xffff : 0;
    const isLink = (unixMode & 0xf000) === 0xa000;
    if (name.endsWith('/')) { await fsp.mkdir(target, { recursive: true }); continue; }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const data = entryData(buf, e);
    if (isLink) {
      const linkTarget = data.toString('utf8');
      const resolved = path.resolve(path.dirname(target), linkTarget);
      if (!resolved.startsWith(root)) throw new Error(`Unsafe symlink in zip: ${e.name}`);
      await fsp.rm(target, { force: true });
      try { await fsp.symlink(linkTarget, target); } catch { await fsp.writeFile(target, data); }
    } else {
      await fsp.writeFile(target, data);
      if (unixMode & 0o777) await fsp.chmod(target, unixMode & 0o777).catch(() => {});
    }
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Writer                                                               */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipInput { name: string; data?: Buffer; file?: string; mode?: number; symlink?: string }

/** Write a zip from files on disk or buffers (no ZIP64; fine for module packages and game folders < 4 GB). */
export async function writeZip(out: string, inputs: ZipInput[]): Promise<void> {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const inp of inputs) {
    const nameBuf = Buffer.from(inp.name.replace(/\\/g, '/'), 'utf8');
    const isDir = inp.name.endsWith('/');
    let data = inp.symlink !== undefined ? Buffer.from(inp.symlink, 'utf8') : isDir ? Buffer.alloc(0) : inp.data ?? (await fsp.readFile(inp.file!));
    const crc = crc32(data);
    const deflated = data.length > 64 && !inp.symlink ? zlib.deflateRawSync(data, { level: 6 }) : null;
    const useDeflate = !!deflated && deflated.length < data.length;
    const body = useDeflate ? deflated! : data;
    const mode = inp.symlink !== undefined ? 0o120777 : isDir ? 0o40755 : 0o100000 | (inp.mode ?? 0o644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
    data = Buffer.alloc(0);
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, Buffer.concat([...chunks, cdBuf, end]));
}

/** Zip a whole folder (keeps symlinks and executable bits). */
export async function zipDir(dir: string, out: string, prefix = ''): Promise<void> {
  const inputs: ZipInput[] = [];
  const walk = async (d: string, rel: string) => {
    for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) inputs.push({ name: prefix + r, symlink: await fsp.readlink(full) });
      else if (ent.isDirectory()) { inputs.push({ name: `${prefix}${r}/` }); await walk(full, r); }
      else { const st = await fsp.stat(full); inputs.push({ name: prefix + r, file: full, mode: st.mode & 0o777 }); }
    }
  };
  await walk(dir, '');
  await writeZip(out, inputs);
}
