#!/usr/bin/env node
/**
 * Packages a module folder as a .vnemod file (a zip with module.json at its root).
 *
 *   npm run pack-module -- examples/extensions/relationships [--out dist/modules]
 *
 * The manifest is checked first (id, version, entry files, locales). Hidden files,
 * node_modules and previous .vnemod files are skipped.
 */
import { deflateRawSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
if (!dir) { console.error('Usage: npm run pack-module -- <module-folder> [--out <folder>]'); process.exit(1); }
const src = path.resolve(dir);
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve('dist', 'modules');

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
if (!existsSync(path.join(src, 'module.json'))) fail(`${src} has no module.json`);
let m;
try { m = JSON.parse(await readFile(path.join(src, 'module.json'), 'utf8')); } catch (e) { fail(`module.json is not valid JSON: ${e.message}`); }
if (!/^[a-z0-9]+([.-][a-z0-9]+)*(\.[a-z0-9-]+)+$/i.test(m.id || '')) fail('id must be a reverse-domain id such as "com.yourname.my-module"');
if (!/^\d+\.\d+\.\d+/.test(m.version || '')) fail('version must be semver, e.g. "1.0.0"');
if (!m.engine) fail('engine (compatible editor versions) is required, e.g. ">=0.1.0 <1.0.0"');
if (!m.runtime && !m.editor) fail('module.json needs a "runtime" and/or "editor" entry');
for (const k of ['runtime', 'editor']) if (m[k] && !existsSync(path.join(src, m[k]))) fail(`${k} entry "${m[k]}" does not exist`);
if (m.locales && !existsSync(path.join(src, m.locales))) fail(`locales folder "${m.locales}" does not exist`);
if (m.locales) for (const f of await readdir(path.join(src, m.locales))) if (f.endsWith('.json')) {
  try { JSON.parse(await readFile(path.join(src, m.locales, f), 'utf8')); } catch (e) { fail(`${m.locales}/${f} is not valid JSON: ${e.message}`); }
}

const files = [];
async function walk(d, rel = '') {
  for (const e of await readdir(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name.endsWith('.vnemod')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(path.join(d, e.name), r);
    else if (e.isFile()) files.push(r);
  }
}
await walk(src);

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const locals = [], centrals = [];
let offset = 0;
for (const name of files.sort()) {
  const data = await readFile(path.join(src, name));
  const st = await stat(path.join(src, name));
  const comp = deflateRawSync(data, { level: 9 });
  const useDeflate = comp.length < data.length;
  const body = useDeflate ? comp : data;
  const nameBuf = Buffer.from(name, 'utf8');
  const d = st.mtime;
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
  lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x0314, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
  ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(((0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
  locals.push(lh, nameBuf, body);
  centrals.push(ch, nameBuf);
  offset += lh.length + nameBuf.length + body.length;
}
const cd = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
await mkdir(outDir, { recursive: true });
const out = path.join(outDir, `${m.id}-${m.version}.vnemod`);
await writeFile(out, Buffer.concat([...locals, cd, end]));
console.log(`✓ ${path.relative(process.cwd(), out)} (${files.length} files)`);
