/**
 * The user's preset library (shared by every project): scenes (a group of elements with
 * their animation) and characters (with rig, motions and expressions). Each entry is a
 * folder `<userData>/library/<kind>/<id>/` holding `preset.json` and copies of the asset
 * files it uses, so it can be loaded into any project.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Asset } from '@vne/core';
import { importAssets } from './assets';

export type LibraryKind = 'scene' | 'character';
const KINDS: LibraryKind[] = ['scene', 'character'];

export interface LibraryAsset { id: string; name: string; kind: Asset['kind']; file: string }
export interface LibraryEntry {
  id: string;
  kind: LibraryKind;
  name: string;
  savedAt: string;
  /** Small JPEG data URL. */
  thumbnail?: string;
  /** What the entry holds (scene: { layers, tracks, characters }, character: a Character). */
  data: unknown;
  assets: LibraryAsset[];
}

const ID = /^[\w-]{1,64}$/;

export class LibraryStore {
  constructor(readonly root: string) {}

  private dir(kind: string, id?: string): string {
    if (!KINDS.includes(kind as LibraryKind)) throw new Error(`Unknown library kind "${kind}"`);
    if (id !== undefined && !ID.test(id)) throw new Error('Invalid library id');
    return id === undefined ? path.join(this.root, kind) : path.join(this.root, kind, id);
  }

  async list(kind: string): Promise<LibraryEntry[]> {
    const base = this.dir(kind);
    const names = await fsp.readdir(base).catch(() => [] as string[]);
    const out: LibraryEntry[] = [];
    for (const n of names) {
      if (!ID.test(n)) continue;
      try { out.push(JSON.parse(await fsp.readFile(path.join(base, n, 'preset.json'), 'utf8'))); } catch { /* skip broken entries */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Save (or replace) an entry; the project's asset files it uses are copied in. */
  async save(kind: string, entry: { id: string; name: string; thumbnail?: string; data: unknown }, projectDir: string, assets: Asset[]): Promise<LibraryEntry> {
    const dir = this.dir(kind, entry.id);
    const tmp = `${dir}.tmp-${Date.now()}`;
    await fsp.mkdir(path.join(tmp, 'files'), { recursive: true });
    const list: LibraryAsset[] = [];
    const seen = new Set<string>();
    for (const a of assets) {
      if (!a || seen.has(a.id) || !ID.test(a.id)) continue;
      seen.add(a.id);
      const src = path.resolve(projectDir, a.path);
      if (!src.startsWith(path.resolve(projectDir) + path.sep)) continue;
      const file = `${a.id}${path.extname(a.path).toLowerCase()}`;
      try { await fsp.copyFile(src, path.join(tmp, 'files', file)); } catch { continue; } // missing files are left out
      list.push({ id: a.id, name: a.name, kind: a.kind, file });
    }
    const out: LibraryEntry = {
      id: entry.id, kind: kind as LibraryKind, name: String(entry.name || 'Preset').slice(0, 80), savedAt: new Date().toISOString(),
      ...(typeof entry.thumbnail === 'string' && entry.thumbnail.length < 400_000 ? { thumbnail: entry.thumbnail } : {}),
      data: entry.data, assets: list,
    };
    await fsp.writeFile(path.join(tmp, 'preset.json'), JSON.stringify(out));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    await fsp.rename(tmp, dir);
    return out;
  }

  /**
   * Bring an entry's files into a project. Files the project already has (same content) are
   * reused. Returns the entry, the new assets to add and a map from the entry's asset ids
   * to the project's.
   */
  async load(kind: string, id: string, projectDir: string, existing: Asset[]): Promise<{ entry: LibraryEntry; assets: Asset[]; map: Record<string, string>; errors: string[] }> {
    const dir = this.dir(kind, id);
    const entry: LibraryEntry = JSON.parse(await fsp.readFile(path.join(dir, 'preset.json'), 'utf8'));
    const map: Record<string, string> = {};
    const added: Asset[] = [];
    const errors: string[] = [];
    let known = [...existing];
    for (const a of entry.assets) {
      const r = await importAssets(projectDir, [{ name: a.name, sourcePath: path.join(dir, 'files', path.basename(a.file)) }], known);
      errors.push(...r.errors);
      const got = r.assets[0]?.id || r.reused[0];
      if (!got) continue;
      map[a.id] = got;
      if (r.assets[0]) { added.push(r.assets[0]); known = [...known, r.assets[0]]; }
    }
    return { entry, assets: added, map, errors };
  }

  async remove(kind: string, id: string): Promise<void> {
    await fsp.rm(this.dir(kind, id), { recursive: true, force: true });
  }

  async rename(kind: string, id: string, name: string): Promise<LibraryEntry> {
    const file = path.join(this.dir(kind, id), 'preset.json');
    const entry: LibraryEntry = JSON.parse(await fsp.readFile(file, 'utf8'));
    entry.name = String(name || entry.name).slice(0, 80);
    await fsp.writeFile(file, JSON.stringify(entry));
    return entry;
  }
}
