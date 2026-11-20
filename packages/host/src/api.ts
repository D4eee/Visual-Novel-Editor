import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Project } from '@vne/core';
import { loadProject } from '@vne/core';
import { exists, isDir, readJson, within } from './fsutil';
import { createProjectFolder, copyProjectFolder, openProjectFolder, saveProjectFile, writeAutosave, clearAutosave, RecentList, PROJECT_FILE } from './projects';
import { importAssets, missingAssets, relinkAsset, IncomingFile } from './assets';
import { ModuleStore, ModuleScope } from './modules';
import { TemplateStore, ELECTRON_VERSION } from './templates';
import { exportGame, ExportOptions } from './exporter';

export interface HostConfig {
  mode: 'electron' | 'browser';
  /** Folder containing dist/ (player bundle, player shell). */
  distDir: string;
  /** Folder with bundled examples (examples/games, examples/extensions). */
  examplesDir: string;
  userDataDir: string;
  /** Base for file URLs, e.g. "http://127.0.0.1:5199/fs/" or "vne-fs://fs/". */
  urlBase: string;
  templateDirs?: string[];
  dialogs?: {
    pickFolder(opts: { title?: string; defaultPath?: string }): Promise<string | null>;
    pickFiles(opts: { title?: string; filters?: { name: string; extensions: string[] }[]; multiple?: boolean }): Promise<string[]>;
    reveal(p: string): void;
  };
}

export const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/**
 * The host API: every operation the editor needs from the operating system.
 * The same table is served over IPC (Electron) and HTTP (browser mode), so the
 * editor code is identical in both.
 */
export function createHost(cfg: HostConfig) {
  const roots = new Map<string, string>();
  const allowRoot = (dir: string) => { const k = b64url(path.resolve(dir)); roots.set(k, path.resolve(dir)); return k; };
  const recent = new RecentList(path.join(cfg.userDataDir, 'recent.json'));
  const libraryDir = path.join(cfg.userDataDir, 'modules');
  const store = new ModuleStore(libraryDir, [path.join(cfg.examplesDir, 'extensions')]);
  const templates = new TemplateStore(path.join(cfg.userDataDir, 'runtime-templates'), cfg.templateDirs || []);
  const fileUrl = (root: string, rel = '') => `${cfg.urlBase}${allowRoot(root)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  allowRoot(path.join(cfg.examplesDir));

  const listModules = async (projectPath?: string | null) => {
    const mods = await store.list(projectPath);
    return mods.map((m) => ({ manifest: m.manifest, scope: m.scope, dir: m.dir, baseUrl: fileUrl(m.dir), locales: m.locales, problems: m.problems, compatible: m.compatible }));
  };

  const methods: Record<string, (args: any) => Promise<any>> = {
    async info() {
      return { mode: cfg.mode, platform: process.platform, arch: process.arch, home: os.homedir(), userDataDir: cfg.userDataDir, libraryDir, urlBase: cfg.urlBase, nativeDialogs: !!cfg.dialogs, electronVersion: ELECTRON_VERSION, examplesDir: cfg.examplesDir };
    },
    async 'recent.list'() { return recent.list(); },
    async 'recent.remove'({ path: p }) { await recent.remove(p); return true; },

    async 'fs.listDir'({ path: p }) {
      const dir = path.resolve(p || os.homedir());
      const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      const entries = ents.filter((e) => !e.name.startsWith('.')).map((e) => ({ name: e.name, dir: e.isDirectory() })).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return { path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, entries, isProject: await exists(path.join(dir, PROJECT_FILE)) };
    },
    async 'fs.mkdir'({ path: p }) { await fsp.mkdir(p, { recursive: true }); return true; },
    async 'dialog.pickFolder'(a) { return cfg.dialogs ? cfg.dialogs.pickFolder(a || {}) : null; },
    async 'dialog.pickFiles'(a) { return cfg.dialogs ? cfg.dialogs.pickFiles(a || {}) : null; },
    async 'shell.reveal'({ path: p }) { cfg.dialogs?.reveal(p); return true; },

    async 'examples.list'() {
      const dir = path.join(cfg.examplesDir, 'games');
      if (!(await isDir(dir))) return [];
      const out: any[] = [];
      for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const pf = path.join(dir, ent.name, PROJECT_FILE);
        if (!(await exists(pf))) continue;
        try { const p: Project = await readJson(pf); out.push({ id: ent.name, name: p.name, description: p.settings?.description || '', path: path.join(dir, ent.name) }); } catch { /* skip */ }
      }
      return out;
    },

    async 'project.create'({ dir, json, template }) {
      if (template) await copyProjectFolder(template, dir);
      else await createProjectFolder(dir, json);
      const { project } = loadProject(await fsp.readFile(path.join(dir, PROJECT_FILE), 'utf8'));
      if (template && json) {
        // rename the copy to the name given by the creator
        const given = JSON.parse(json);
        project.name = given.name;
        project.settings.title = given.name;
        project.id = given.id;
        await saveProjectFile(dir, JSON.stringify(project, null, 2));
      }
      await recent.add(dir, project.name);
      return { path: dir };
    },
    async 'project.open'({ path: p }) {
      const r = await openProjectFolder(p);
      const { project } = loadProject(r.json);
      await recent.add(r.path, project.name);
      const missing = await missingAssets(r.path, project.assets);
      return { ...r, missingAssets: missing, fileBase: fileUrl(r.path) };
    },
    async 'project.save'({ path: p, json }) {
      const r = await saveProjectFile(p, json);
      try { await recent.add(p, JSON.parse(json).name); } catch { /* ignore */ }
      return r;
    },
    async 'project.autosave'({ path: p, json }) { await writeAutosave(p, json); return true; },
    async 'project.clearAutosave'({ path: p }) { await clearAutosave(p); return true; },

    async 'assets.import'({ path: p, files, existing }) { return importAssets(p, files as IncomingFile[], existing || []); },
    async 'assets.missing'({ path: p, assets }) { return missingAssets(p, assets || []); },
    async 'assets.relink'({ path: p, asset, file }) { return relinkAsset(p, asset, file); },

    async 'modules.list'({ path: p }) { return listModules(p); },
    async 'modules.install'({ source, scope, path: p }) {
      const m = await store.install(source, (scope || 'library') as ModuleScope, p);
      return { manifest: m.manifest, scope: m.scope, problems: m.problems };
    },
    async 'modules.remove'({ id, scope, path: p }) { await store.remove(id, scope, p); return true; },
    async 'modules.copyToProject'({ id, path: p }) {
      const m = await store.find(id, null);
      if (!m) throw new Error(`Module ${id} is not in the library`);
      const r = await store.install(m.dir, 'project', p);
      return { manifest: r.manifest };
    },

    async 'export.templates'() { return templates.status(); },
    async 'export.run'({ path: p, json, options }) {
      const logs: string[] = [];
      const { project } = loadProject(json);
      const result = await exportGame({
        playerDir: path.join(cfg.distDir, 'player'),
        playerShellDir: path.join(cfg.distDir, 'player-shell'),
        modules: store,
        templates,
        log: (m) => { logs.push(m); console.log(`[export] ${m}`); },
      }, p, project, options as ExportOptions);
      return { ...result, logs };
    },
  };

  /** Resolve a file URL path ("<root>/<rel>") to a file on disk, refusing anything outside registered roots. */
  async function resolveFile(urlPath: string): Promise<string | null> {
    const [key, ...rest] = urlPath.replace(/^\/+/, '').split('/');
    let root = roots.get(key);
    if (!root) {
      // A root becomes valid once a project at that path has been opened or its modules listed.
      const decoded = Buffer.from(key, 'base64url').toString('utf8');
      if (!(await exists(path.join(decoded, PROJECT_FILE))) && !(await exists(path.join(decoded, 'module.json')))) return null;
      allowRoot(decoded);
      root = path.resolve(decoded);
    }
    const rel = rest.map((s) => decodeURIComponent(s)).join('/');
    try { return within(root, rel); } catch { return null; }
  }

  return { methods, resolveFile, allowRoot, fileUrl, store, templates };
}

export type Host = ReturnType<typeof createHost>;
