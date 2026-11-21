import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import type { Project } from '@vne/core';
import { loadProject } from '@vne/core';
import { exists, isDir, readJson, within } from './fsutil';
import { createProjectFolder, copyProjectFolder, openProjectFolder, saveProjectFile, writeAutosave, clearAutosave, RecentList, PROJECT_FILE } from './projects';
import { importAssets, missingAssets, relinkAsset, IncomingFile } from './assets';
import { ModuleStore, ModuleScope } from './modules';
import { TemplateStore, ELECTRON_VERSION } from './templates';
import { exportGame, ExportOptions } from './exporter';
import { EffectPresetStore } from './effectPresets';

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
  /** Bundled examples are read-only (packaged app): "Open" works on a copy in the user data folder. */
  examplesReadOnly?: boolean;
  dialogs?: {
    pickFolder(opts: { title?: string; defaultPath?: string }): Promise<string | null>;
    pickFiles(opts: { title?: string; filters?: { name: string; extensions: string[] }[]; multiple?: boolean }): Promise<string[]>;
    reveal(p: string): void;
    /** Move a file or folder to the system Trash (desktop). */
    trash?(p: string): Promise<void>;
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
  const effectPresets = new EffectPresetStore(path.join(cfg.userDataDir, 'effect-presets'));
  const templates = new TemplateStore(path.join(cfg.userDataDir, 'runtime-templates'), cfg.templateDirs || []);
  const fileUrl = (root: string, rel = '') => `${cfg.urlBase}${allowRoot(root)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  allowRoot(path.join(cfg.examplesDir));

  const listModules = async (projectPath?: string | null) => {
    const mods = await store.list(projectPath);
    return mods.map((m) => ({ manifest: m.manifest, scope: m.scope, dir: m.dir, baseUrl: fileUrl(m.dir), locales: m.locales, problems: m.problems, compatible: m.compatible }));
  };

  const methods: Record<string, (args: any) => Promise<any>> = {
    async info() {
      return { mode: cfg.mode, platform: process.platform, arch: process.arch, home: os.homedir(), userDataDir: cfg.userDataDir, libraryDir, effectPresetsDir: effectPresets.dir, urlBase: cfg.urlBase, nativeDialogs: !!cfg.dialogs, electronVersion: ELECTRON_VERSION, examplesDir: cfg.examplesDir, examplesReadOnly: !!cfg.examplesReadOnly };
    },
    async 'recent.list'() { return recent.list(); },
    async 'recent.remove'({ path: p }) { await recent.remove(p); return true; },
    /**
     * Delete a project: its folder goes to the system Trash (desktop) or, in browser mode,
     * into "trash" in the editor's data folder, so it can still be recovered.
     */
    async 'project.trash'({ path: p }) {
      const dir = path.resolve(String(p));
      if (!(await exists(path.join(dir, PROJECT_FILE)))) throw new Error('Not a project folder');
      const ex = path.resolve(cfg.examplesDir);
      if (dir === ex || dir.startsWith(ex + path.sep)) throw new Error('Bundled examples cannot be deleted');
      await recent.remove(dir);
      await recent.remove(String(p));
      if (cfg.dialogs?.trash) { await cfg.dialogs.trash(dir); return { where: 'trash' }; }
      const bin = path.join(cfg.userDataDir, 'trash');
      await fsp.mkdir(bin, { recursive: true });
      const dest = path.join(bin, `${path.basename(dir)}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      try { await fsp.rename(dir, dest); }
      catch { await fsp.cp(dir, dest, { recursive: true }); await fsp.rm(dir, { recursive: true, force: true }); }
      return { where: 'folder', path: dest };
    },

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
        try {
          const p: Project = await readJson(pf);
          const root = path.join(dir, ent.name);
          const icon = p.assets?.find((a) => a.id === p.settings?.iconAssetId);
          out.push({
            id: ent.name, name: p.settings?.title || p.name, description: p.settings?.description || '',
            // Localized descriptions: settings.descriptions = { "zh-CN": "…" }.
            descriptions: p.settings?.descriptions || {}, path: root,
            iconUrl: icon && (await exists(path.join(root, icon.path))) ? fileUrl(root, icon.path) : null,
            scenes: Object.values(p.nodes || {}).filter((n: any) => n.type === 'core.scene').length,
            chapters: (p.chapters || []).length,
          });
        } catch { /* skip */ }
      }
      return out;
    },

    /** Folder to open for an example: the example itself, or (read-only examples) the user's own copy of it. */
    async 'examples.workingCopy'({ id }) {
      const src = path.join(cfg.examplesDir, 'games', path.basename(String(id)));
      if (!(await exists(path.join(src, PROJECT_FILE)))) throw new Error(`Example "${id}" not found`);
      if (!cfg.examplesReadOnly) return { path: src };
      const dest = path.join(cfg.userDataDir, 'examples', path.basename(String(id)));
      const hash = async (f: string) => createHash('sha1').update(await fsp.readFile(f)).digest('hex');
      const marker = path.join(dest, '.vne', 'example-source.json');
      const srcHash = await hash(path.join(src, PROJECT_FILE));
      if (await exists(path.join(dest, PROJECT_FILE))) {
        const m = await readJson<{ srcHash?: string; copyHash?: string }>(marker).catch(() => null);
        if (m?.srcHash === srcHash) return { path: dest };
        // A newer version of the example ships with this editor. An untouched copy is
        // replaced; an edited one (or one made by an older editor) is kept next to it.
        if (m && m.copyHash === (await hash(path.join(dest, PROJECT_FILE)))) await fsp.rm(dest, { recursive: true, force: true });
        else {
          let keep = `${dest} (your copy ${new Date().toISOString().slice(0, 10)})`, i = 2;
          while (await exists(keep)) keep = `${dest} (your copy ${new Date().toISOString().slice(0, 10)} ${i++})`;
          await fsp.rename(dest, keep);
        }
      }
      await copyProjectFolder(src, dest);
      await fsp.mkdir(path.dirname(marker), { recursive: true });
      await fsp.writeFile(marker, JSON.stringify({ srcHash, copyHash: await hash(path.join(dest, PROJECT_FILE)) }));
      return { path: dest };
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

    // Effect presets (the user's library, shared by all projects)
    async 'effectPresets.list'() { return effectPresets.list(); },
    async 'effectPresets.save'({ preset }) { return effectPresets.save(preset); },
    async 'effectPresets.delete'({ id }) { await effectPresets.remove(String(id)); return true; },
    async 'effectPresets.import'({ paths }) { return effectPresets.import((paths || []).map(String)); },
    async 'effectPresets.export'({ id, dir }) { return { path: await effectPresets.export(String(id), String(dir)) }; },

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
