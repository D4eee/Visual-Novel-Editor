/** The user's element presets (saved looks of an element): one `<id>.json` file each in the user data folder. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface ElementPreset {
  id: string;
  name: string;
  /** Element type the preset was saved from (e.g. core.text); it applies to elements of this type. */
  layerType: string;
  props: Record<string, unknown>;
  effect?: unknown;
  blend?: string;
  savedAt?: string;
}

function parse(raw: unknown): ElementPreset {
  const p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as any;
  if (!p || typeof p !== 'object') throw new Error('Not a preset');
  if (typeof p.id !== 'string' || !/^[\w-]{1,64}$/.test(p.id)) throw new Error('Invalid preset id');
  if (typeof p.layerType !== 'string' || !p.layerType) throw new Error('Missing element type');
  if (!p.props || typeof p.props !== 'object') throw new Error('Missing properties');
  return {
    id: p.id,
    name: String(p.name || 'Preset').slice(0, 80),
    layerType: p.layerType,
    props: p.props,
    ...(p.effect ? { effect: p.effect } : {}),
    ...(typeof p.blend === 'string' ? { blend: p.blend } : {}),
    ...(p.savedAt ? { savedAt: String(p.savedAt) } : {}),
  };
}

export class ElementPresetStore {
  constructor(readonly dir: string) {}

  private file(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid preset id');
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<ElementPreset[]> {
    const names = await fsp.readdir(this.dir).catch(() => [] as string[]);
    const out: ElementPreset[] = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      try { out.push(parse(await fsp.readFile(path.join(this.dir, n), 'utf8'))); } catch { /* skip unreadable files */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(preset: unknown): Promise<ElementPreset> {
    const p = parse(preset);
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
}
