/** The user's effect preset library: one `<id>.vnefx` JSON file per preset in the user data folder. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { EffectPreset } from '@vne/core';
import { parseEffectPreset, EFFECT_PRESET_EXT } from '@vne/core';

export class EffectPresetStore {
  constructor(readonly dir: string) {}

  private file(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid preset id');
    return path.join(this.dir, `${id}.${EFFECT_PRESET_EXT}`);
  }

  async list(): Promise<(EffectPreset & { problem?: string })[]> {
    const names = await fsp.readdir(this.dir).catch(() => [] as string[]);
    const out: EffectPreset[] = [];
    for (const n of names.filter((x) => x.endsWith(`.${EFFECT_PRESET_EXT}`))) {
      try { out.push(parseEffectPreset(await fsp.readFile(path.join(this.dir, n), 'utf8'))); } catch { /* skip unreadable files */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(preset: unknown): Promise<EffectPreset> {
    const p = parseEffectPreset(preset);
    p.savedAt = new Date().toISOString();
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(p.id)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(p, null, 2));
    await fsp.rename(tmp, this.file(p.id));
    return p;
  }

  async remove(id: string): Promise<void> {
    await fsp.rm(this.file(id), { force: true });
  }

  /** Add preset files to the library (a preset with the same id is replaced). */
  async import(paths: string[]): Promise<{ imported: EffectPreset[]; errors: { path: string; message: string }[] }> {
    const imported: EffectPreset[] = [];
    const errors: { path: string; message: string }[] = [];
    for (const p of paths) {
      try { imported.push(await this.save(parseEffectPreset(await fsp.readFile(p, 'utf8')))); }
      catch (e: any) { errors.push({ path: p, message: e?.message || String(e) }); }
    }
    return { imported, errors };
  }

  /** Write a preset file into a folder, named after the preset. Returns its path. */
  async export(id: string, dir: string): Promise<string> {
    const p = parseEffectPreset(await fsp.readFile(this.file(id), 'utf8'));
    const base = p.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || p.id;
    let out = path.join(dir, `${base}.${EFFECT_PRESET_EXT}`);
    for (let i = 2; await fsp.access(out).then(() => true, () => false); i++) out = path.join(dir, `${base} ${i}.${EFFECT_PRESET_EXT}`);
    await fsp.writeFile(out, JSON.stringify(p, null, 2));
    return out;
  }
}
