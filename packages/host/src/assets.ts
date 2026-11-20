import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Asset } from '@vne/core';
import { newId } from '@vne/core';
import { exists, hashBuffer, imageSize, kindOf, toPosix, within } from './fsutil';

export interface IncomingFile {
  name: string;
  /** Absolute path on disk (Electron drag/drop, file dialog, browser-mode picker). */
  sourcePath?: string;
  /** Base64 data (browser drag & drop). */
  dataBase64?: string;
}

const FOLDER: Record<string, string> = { image: 'images', audio: 'audio', video: 'video', font: 'fonts', other: 'other' };

/**
 * Copy files into the project's assets folder. Identical files (same content
 * hash) are not duplicated: the existing asset is returned instead.
 */
export async function importAssets(projectDir: string, files: IncomingFile[], existing: Asset[]): Promise<{ assets: Asset[]; reused: string[]; errors: string[] }> {
  const out: Asset[] = [];
  const reused: string[] = [];
  const errors: string[] = [];
  const byHash = new Map(existing.filter((a) => a.hash).map((a) => [a.hash!, a]));
  for (const f of files) {
    try {
      const buf = f.dataBase64 !== undefined ? Buffer.from(f.dataBase64, 'base64') : await fsp.readFile(f.sourcePath!);
      const hash = hashBuffer(buf);
      const dupe = byHash.get(hash);
      if (dupe && (await exists(path.join(projectDir, dupe.path)))) { reused.push(dupe.id); continue; }
      const kind = kindOf(f.name);
      const folder = path.join(projectDir, 'assets', FOLDER[kind]);
      await fsp.mkdir(folder, { recursive: true });
      const base = path.basename(f.name).replace(/[\\/:*?"<>|]/g, '_');
      let target = path.join(folder, base);
      let i = 1;
      while (await exists(target)) {
        const ext = path.extname(base);
        target = path.join(folder, `${path.basename(base, ext)}-${i++}${ext}`);
      }
      await fsp.writeFile(target, buf);
      const meta: Asset['meta'] = {};
      if (kind === 'image') Object.assign(meta, imageSize(buf) || {});
      const asset: Asset = {
        id: newId('ast'),
        name: path.basename(target),
        kind,
        path: toPosix(path.relative(projectDir, target)),
        size: buf.length,
        hash,
        tags: [],
        meta,
        imported: new Date().toISOString(),
      };
      byHash.set(hash, asset);
      out.push(asset);
    } catch (err: any) {
      errors.push(`${f.name}: ${err?.message || err}`);
    }
  }
  return { assets: out, reused, errors };
}

export async function missingAssets(projectDir: string, assets: Asset[]): Promise<string[]> {
  const missing: string[] = [];
  for (const a of assets) {
    try {
      if (!(await exists(within(projectDir, a.path)))) missing.push(a.id);
    } catch { missing.push(a.id); }
  }
  return missing;
}

/** Point an asset at a new file. The asset id stays the same, so every reference keeps working. */
export async function relinkAsset(projectDir: string, asset: Asset, file: IncomingFile): Promise<Asset> {
  const imported = await importAssets(projectDir, [file], []);
  if (imported.errors.length) throw new Error(imported.errors.join('; '));
  const fresh = imported.assets[0];
  return { ...asset, path: fresh.path, size: fresh.size, hash: fresh.hash, meta: { ...asset.meta, ...fresh.meta }, kind: fresh.kind };
}
