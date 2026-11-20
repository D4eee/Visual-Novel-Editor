import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ModuleManifest } from '@vne/core';
import { validateManifest, checkCompatibility, compareVersions } from '@vne/core';
import { copyDir, exists, isDir, readJson, within } from './fsutil';
import { extractZip, listZip } from './zip';

export type ModuleScope = 'project' | 'library';

export interface InstalledModule {
  manifest: ModuleManifest;
  scope: ModuleScope;
  dir: string;
  locales: Record<string, Record<string, string>>;
  problems: string[];
  compatible: boolean;
}

async function readModuleDir(dir: string, scope: ModuleScope): Promise<InstalledModule | null> {
  const mf = path.join(dir, 'module.json');
  if (!(await exists(mf))) return null;
  let manifest: ModuleManifest;
  try { manifest = await readJson(mf); }
  catch (err: any) { return { manifest: { id: path.basename(dir), name: path.basename(dir), version: '0.0.0', engine: '*' } as ModuleManifest, scope, dir, locales: {}, problems: [`module.json is not valid JSON: ${err?.message}`], compatible: false }; }
  const problems = validateManifest(manifest).map((p) => `${p.field}: ${p.message}`);
  for (const entry of [manifest.runtime, manifest.editor]) if (entry && !(await exists(path.join(dir, entry)))) problems.push(`entry file "${entry}" is missing`);
  const compat = checkCompatibility(manifest);
  problems.push(...compat.reasons);
  const locales: Record<string, Record<string, string>> = {};
  if (manifest.locales) {
    const ldir = path.join(dir, manifest.locales);
    if (await isDir(ldir)) for (const f of await fsp.readdir(ldir)) if (f.endsWith('.json')) {
      try { locales[f.replace(/\.json$/, '')] = await readJson(path.join(ldir, f)); } catch { problems.push(`locale ${f} is not valid JSON`); }
    }
  }
  return { manifest, scope, dir, locales, problems, compatible: compat.ok };
}

export class ModuleStore {
  constructor(readonly libraryDir: string, readonly bundledDirs: string[] = []) {}

  /** Modules available: project-local first (they win), then the user library, then bundled examples. */
  async list(projectDir?: string | null): Promise<InstalledModule[]> {
    const found = new Map<string, InstalledModule>();
    const scan = async (root: string, scope: ModuleScope) => {
      if (!(await isDir(root))) return;
      for (const ent of await fsp.readdir(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const m = await readModuleDir(path.join(root, ent.name), scope);
        if (!m) continue;
        const prev = found.get(m.manifest.id);
        if (!prev || (prev.scope === 'library' && scope === 'library' && compareVersions(m.manifest.version, prev.manifest.version) > 0)) found.set(m.manifest.id, m);
      }
    };
    if (projectDir) await scan(path.join(projectDir, 'modules'), 'project');
    await scan(this.libraryDir, 'library');
    for (const b of this.bundledDirs) await scan(b, 'library');
    return [...found.values()];
  }

  /**
   * Install from a folder, a .zip or a .vnemod package. Installing into a project copies
   * the module into <project>/modules so the project stays portable.
   */
  async install(source: string, scope: ModuleScope, projectDir?: string | null): Promise<InstalledModule> {
    const targetRoot = scope === 'project' ? path.join(projectDir || '', 'modules') : this.libraryDir;
    if (scope === 'project' && !projectDir) throw new Error('No project is open');
    let srcDir = source;
    let tmp: string | null = null;
    if (!(await isDir(source))) {
      tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vne-mod-'));
      const names = await listZip(source);
      const prefix = names.includes('module.json') ? '' : (names.find((n) => /^[^/]+\/module\.json$/.test(n)) || '').replace('module.json', '');
      if (!names.includes('module.json') && !prefix) throw new Error('The package has no module.json');
      await extractZip(source, tmp, { stripPrefix: prefix });
      srcDir = tmp;
    }
    try {
      const m = await readModuleDir(srcDir, scope);
      if (!m) throw new Error('No module.json found');
      const hard = validateManifest(m.manifest);
      if (hard.length) throw new Error(`Invalid module.json: ${hard.map((p) => `${p.field}: ${p.message}`).join('; ')}`);
      const dest = within(targetRoot, m.manifest.id);
      if (path.resolve(dest) !== path.resolve(srcDir)) {
        await fsp.rm(dest, { recursive: true, force: true });
        await copyDir(srcDir, dest, (rel) => !rel.startsWith('node_modules') && !rel.startsWith('.git'));
      }
      return (await readModuleDir(dest, scope))!;
    } finally {
      if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
    }
  }

  async remove(id: string, scope: ModuleScope, projectDir?: string | null): Promise<void> {
    const root = scope === 'project' ? path.join(projectDir || '', 'modules') : this.libraryDir;
    const dir = within(root, id);
    if (!(await exists(path.join(dir, 'module.json')))) throw new Error(`Module ${id} is not installed in the ${scope}`);
    await fsp.rm(dir, { recursive: true, force: true });
  }

  async find(id: string, projectDir?: string | null): Promise<InstalledModule | undefined> {
    return (await this.list(projectDir)).find((m) => m.manifest.id === id);
  }
}
