import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWrite, exists, isDir, readJson, copyDir } from './fsutil';

export const PROJECT_FILE = 'project.vne.json';
export const META_DIR = '.vne';
const BACKUPS = 10;

export interface OpenResult {
  path: string;
  json: string;
  /** Newer unsaved state found from autosave (crash recovery). */
  recovery: { json: string; time: string } | null;
}

/** Accept a project folder or the project file itself. */
export async function resolveProjectDir(p: string): Promise<string> {
  if (await isDir(p)) {
    if (await exists(path.join(p, PROJECT_FILE))) return p;
    throw new Error(`No ${PROJECT_FILE} in ${p}`);
  }
  if (path.basename(p) === PROJECT_FILE) return path.dirname(p);
  throw new Error(`Not a project: ${p}`);
}

export async function createProjectFolder(dir: string, json: string): Promise<string> {
  if (await exists(path.join(dir, PROJECT_FILE))) throw new Error('A project already exists in this folder.');
  await fsp.mkdir(dir, { recursive: true });
  for (const sub of ['assets/images', 'assets/audio', 'assets/video', 'assets/fonts', 'modules', META_DIR]) await fsp.mkdir(path.join(dir, sub), { recursive: true });
  await atomicWrite(path.join(dir, PROJECT_FILE), json);
  await atomicWrite(path.join(dir, '.gitignore'), `${META_DIR}/autosave.json\n${META_DIR}/backups/\nexports/\n`);
  return dir;
}

/** Copy a template/example project (with its assets and modules) to a new folder. */
export async function copyProjectFolder(src: string, dest: string): Promise<void> {
  if (await exists(path.join(dest, PROJECT_FILE))) throw new Error('A project already exists in this folder.');
  await copyDir(src, dest, (rel) => !rel.startsWith(`${META_DIR}/`) && rel !== META_DIR && !rel.startsWith('exports'));
}

export async function openProjectFolder(p: string): Promise<OpenResult> {
  const dir = await resolveProjectDir(p);
  const file = path.join(dir, PROJECT_FILE);
  let json: string;
  try {
    json = await fsp.readFile(file, 'utf8');
    JSON.parse(json);
  } catch (err: any) {
    // The main file is damaged: fall back to the newest backup so the creator does not lose work.
    const b = await newestBackup(dir);
    if (!b) throw new Error(`The project file could not be read (${err?.message || err}) and there is no backup.`);
    json = await fsp.readFile(b, 'utf8');
    return { path: dir, json, recovery: { json, time: (await fsp.stat(b)).mtime.toISOString() } };
  }
  let recovery: OpenResult['recovery'] = null;
  const auto = path.join(dir, META_DIR, 'autosave.json');
  if (await exists(auto)) {
    const [a, m] = await Promise.all([fsp.stat(auto), fsp.stat(file)]);
    if (a.mtimeMs > m.mtimeMs + 1000) {
      try {
        const aj = await fsp.readFile(auto, 'utf8');
        JSON.parse(aj);
        if (aj !== json) recovery = { json: aj, time: a.mtime.toISOString() };
      } catch { /* damaged autosave is ignored */ }
    }
  }
  return { path: dir, json, recovery };
}

export async function saveProjectFile(dir: string, json: string): Promise<{ time: string }> {
  JSON.parse(json); // never write something we cannot read back
  const file = path.join(dir, PROJECT_FILE);
  if (await exists(file)) {
    const bdir = path.join(dir, META_DIR, 'backups');
    await fsp.mkdir(bdir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.copyFile(file, path.join(bdir, `project-${stamp}.json`)).catch(() => {});
    const list = (await fsp.readdir(bdir)).filter((f) => f.startsWith('project-')).sort();
    for (const old of list.slice(0, Math.max(0, list.length - BACKUPS))) await fsp.rm(path.join(bdir, old), { force: true });
  }
  await atomicWrite(file, json);
  await fsp.rm(path.join(dir, META_DIR, 'autosave.json'), { force: true });
  return { time: new Date().toISOString() };
}

export async function writeAutosave(dir: string, json: string): Promise<void> {
  JSON.parse(json);
  await atomicWrite(path.join(dir, META_DIR, 'autosave.json'), json);
}

export async function clearAutosave(dir: string): Promise<void> {
  await fsp.rm(path.join(dir, META_DIR, 'autosave.json'), { force: true });
}

async function newestBackup(dir: string): Promise<string | null> {
  const bdir = path.join(dir, META_DIR, 'backups');
  if (!(await exists(bdir))) return null;
  const list = (await fsp.readdir(bdir)).filter((f) => f.startsWith('project-')).sort();
  return list.length ? path.join(bdir, list[list.length - 1]) : null;
}

/* ------------------------------------------------------------------ */
/* Recent projects                                                      */
/* ------------------------------------------------------------------ */

export interface RecentEntry { path: string; name: string; opened: string }

export class RecentList {
  constructor(private file: string) {}
  async list(): Promise<RecentEntry[]> {
    try {
      const all: RecentEntry[] = await readJson(this.file);
      const out: RecentEntry[] = [];
      for (const r of all) if (await exists(path.join(r.path, PROJECT_FILE))) out.push(r);
      return out;
    } catch { return []; }
  }
  async add(p: string, name: string): Promise<void> {
    const list = (await this.list()).filter((r) => r.path !== p);
    list.unshift({ path: p, name, opened: new Date().toISOString() });
    await atomicWrite(this.file, JSON.stringify(list.slice(0, 20), null, 2));
  }
  async remove(p: string): Promise<void> {
    await atomicWrite(this.file, JSON.stringify((await this.list()).filter((r) => r.path !== p), null, 2));
  }
}
