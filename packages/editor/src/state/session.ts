import type { Project, Issue, Engine, Recipe, UpdateOptions, ModuleManifest, Asset } from '@vne/core';
import { History, loadProject, validateProject, serializeProject, I18n, newId, hasSceneData } from '@vne/core';
import { createEngine, ModuleHost, ModuleRecord, AssetLoader } from '@vne/runtime';
import { call } from '../host';
import { EditorExtensions, activateEditorModule } from '../modules/editorApi';
import { getPrefs } from './prefs';

export type WorkspaceTab = { kind: 'graph' } | { kind: 'node'; nodeId: string } | { kind: 'custom'; id: string };

export interface SceneUI {
  selectedLayers: string[];
  clipId: string | null;
  time: number;
  playing: boolean;
  bottomTab: string;
  selectedLine: string | null;
  view: { zoom: number; x: number; y: number; fit?: boolean } | null;
  record: boolean;
  subTab: 'composition' | 'script' | 'modules';
  selectedKeys: string[];
  showTextbox: boolean;
  snap: boolean;
  scriptId: string | null;
  /** The effect graph editor of the selected element is open. */
  effectsOpen?: boolean;
  /** Tab of the element inspector: options (properties), effects or presets. */
  inspectorTab?: 'options' | 'effects' | 'presets';
}

export const defaultSceneUI = (): SceneUI => ({
  selectedLayers: [], clipId: null, time: 0, playing: false, bottomTab: 'timeline', selectedLine: null, view: null,
  record: false, subTab: 'composition', selectedKeys: [], showTextbox: true, snap: getPrefs().snap, scriptId: null,
});

export interface SessionUI {
  chapterId: string;
  overview: boolean;
  selection: { nodes: string[]; edges: string[] };
  tabs: WorkspaceTab[];
  active: number;
  sidebar: string;
  scene: Record<string, SceneUI>;
  logicTab: Record<string, 'logic' | 'modules'>;
  inspectorOpen: boolean;
  problemsOpen: boolean;
  preview: { scope: 'scene' | 'chapter' | 'game'; nodeId: string | null; key: number; /** Shown in place of the scene canvas (Interactions test runs). */ docked?: boolean } | null;
  /** Story language for previews of a multi-language project (null: the source language). */
  previewLocale?: string | null;
  graphFocus: { nodeId: string; key: number } | null;
  /** Pan/zoom per chapter (kept out of the undo history; written to the project on save). */
  views: Record<string, { x: number; y: number; zoom: number }>;
  /** Draw global and inherited elements on page canvases (default on). */
  showContext?: boolean;
}

export interface InstalledModuleInfo {
  manifest: ModuleManifest;
  scope: 'project' | 'library';
  dir: string;
  baseUrl: string;
  locales: Record<string, Record<string, string>>;
  problems: string[];
  compatible: boolean;
}

export interface ModuleError { moduleId: string; message: string; where: string; time: number }

/**
 * One open project: its undo history, engine (built-ins + the project's modules),
 * editor UI state, validation results and save state.
 */
export class ProjectSession {
  readonly id = newId('ses');
  history: History<Project>;
  engine: Engine;
  moduleHost: ModuleHost;
  moduleRecords: ModuleRecord[] = [];
  installed: InstalledModuleInfo[] = [];
  moduleErrors: ModuleError[] = [];
  /** Blocks that ran recently in the preview (highlighted in Interactions). */
  runningBlocks = new Set<string>();
  private runningTimer = 0;

  markBlockRunning(blockId: string): void {
    this.runningBlocks.add(blockId);
    this.bump();
    clearTimeout(this.runningTimer);
    this.runningTimer = window.setTimeout(() => { this.runningBlocks = new Set(); this.bump(); }, 700);
  }
  ext = new EditorExtensions();
  assets: AssetLoader;
  ui: SessionUI;
  issues: Issue[] = [];
  missingAssets = new Set<string>();
  saving = false;
  lastSaved: string | null = null;
  lastAutosave = 0;
  saveError: string | null = null;
  version = 0;
  private listeners = new Set<() => void>();
  private validateTimer: any = null;
  private autosaveTimer: any = null;
  private autosavedState: Project | null = null;

  constructor(readonly path: string, project: Project, readonly fileBase: string, readonly i18n: I18n) {
    this.history = new History(project);
    this.history.limit = Math.max(20, Math.min(2000, getPrefs().undoLimit || 300));
    this.engine = createEngine();
    this.moduleHost = new ModuleHost(this.engine, i18n, { mode: 'editor', onError: (id, err, where) => this.moduleError(id, err, where) });
    this.assets = new AssetLoader(() => this.project, (a: Asset) => this.assetUrl(a));
    const first = project.editor?.lastChapterId && project.chapters.some((c) => c.id === project.editor!.lastChapterId) ? project.editor!.lastChapterId! : project.chapters[0].id;
    this.ui = {
      chapterId: first, overview: false, selection: { nodes: [], edges: [] }, tabs: [{ kind: 'graph' }], active: 0, sidebar: 'story',
      scene: {}, logicTab: {}, inspectorOpen: true, problemsOpen: false, preview: null, graphFocus: null,
      views: { ...(project.editor?.views || {}) },
    };
    this.history.subscribe(() => { this.bump(); this.scheduleValidate(); this.assets.loadFonts(); });
    // Imported fonts are used by the canvas and previews too.
    this.assets.loadFonts();
    this.autosaveTimer = setInterval(() => this.autosave(), 15000);
    // "Save automatically" (editor settings): save the project file itself once it has been dirty a while.
    this.autoSaveTimer = setInterval(() => {
      const p = getPrefs();
      if (!p.autoSave || !this.dirty || this.saving) return;
      const since = this.dirtySince || (this.dirtySince = Date.now());
      if (Date.now() - since >= Math.max(10, p.autoSaveSeconds) * 1000) { this.dirtySince = 0; this.save().catch(() => {}); }
    }, 5000);
  }
  private autoSaveTimer: any = null;
  private dirtySince = 0;

  get project(): Project {
    return this.history.state;
  }

  get dirty(): boolean {
    return this.history.dirty;
  }

  assetUrl(a: Asset): string {
    return `${this.fileBase}${a.path.split('/').map(encodeURIComponent).join('/')}`;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  bump(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  update(label: string, recipe: Recipe<Project>, opts?: UpdateOptions): void {
    this.history.update(label, recipe, opts);
  }

  setUI(patch: Partial<SessionUI> | ((ui: SessionUI) => Partial<SessionUI>)): void {
    const p = typeof patch === 'function' ? patch(this.ui) : patch;
    this.ui = { ...this.ui, ...p };
    this.bump();
  }

  sceneUI(nodeId: string): SceneUI {
    return this.ui.scene[nodeId] || defaultSceneUI();
  }

  setSceneUI(nodeId: string, patch: Partial<SceneUI>): void {
    this.ui = { ...this.ui, scene: { ...this.ui.scene, [nodeId]: { ...this.sceneUI(nodeId), ...patch } } };
    this.bump();
  }

  /* --------------------------------------------------------------- */
  /* Navigation                                                       */
  /* --------------------------------------------------------------- */

  openNode(nodeId: string, sub?: string): void {
    const node = this.project.nodes[nodeId];
    if (!node) return;
    const def = this.engine.nodeTypes.get(node.type);
    if (!def?.workspace && !node.modules.length && !hasSceneData(node)) {
      // Nodes without a detailed workspace are edited in the inspector; just focus them.
      this.focusNode(nodeId);
      if (sub !== 'modules') return;
    }
    let idx = this.ui.tabs.findIndex((t) => t.kind === 'node' && t.nodeId === nodeId);
    const tabs = [...this.ui.tabs];
    if (idx < 0) { tabs.push({ kind: 'node', nodeId }); idx = tabs.length - 1; }
    this.setUI({ tabs, active: idx, chapterId: node.chapterId });
    if (sub === 'modules') {
      if (node.type === 'core.scene') this.setSceneUI(nodeId, { subTab: 'modules' });
      else this.setUI((ui) => ({ logicTab: { ...ui.logicTab, [nodeId]: 'modules' } }));
    }
  }

  openCustom(id: string): void {
    let idx = this.ui.tabs.findIndex((t) => t.kind === 'custom' && t.id === id);
    const tabs = [...this.ui.tabs];
    if (idx < 0) { tabs.push({ kind: 'custom', id }); idx = tabs.length - 1; }
    this.setUI({ tabs, active: idx });
  }

  closeTab(i: number): void {
    if (this.ui.tabs[i]?.kind === 'graph') return;
    const tabs = this.ui.tabs.filter((_, j) => j !== i);
    let active = this.ui.active;
    if (active >= i) active = Math.max(0, active - 1);
    this.setUI({ tabs, active });
  }

  focusNode(nodeId: string): void {
    const node = this.project.nodes[nodeId];
    if (!node) return;
    this.setUI({ chapterId: node.chapterId, overview: false, active: 0, selection: { nodes: [nodeId], edges: [] }, graphFocus: { nodeId, key: Date.now() } });
  }

  get activeTab(): WorkspaceTab {
    return this.ui.tabs[this.ui.active] || { kind: 'graph' };
  }

  /** The scene the user is looking at (for "preview current scene"). */
  get currentNodeId(): string | null {
    const t = this.activeTab;
    if (t.kind === 'node') return t.nodeId;
    return this.ui.selection.nodes[0] || null;
  }

  /* --------------------------------------------------------------- */
  /* Persistence                                                      */
  /* --------------------------------------------------------------- */

  async save(): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.saveError = null;
    this.bump();
    const state = this.history.state;
    try {
      const withView = { ...state, editor: { ...(state.editor || {}), views: { ...(state.editor?.views || {}), ...this.ui.views }, lastChapterId: this.ui.chapterId } };
      await call('project.save', { path: this.path, json: serializeProject(withView) });
      this.history.markSaved(state);
      this.lastSaved = new Date().toISOString();
      this.autosavedState = state;
      return true;
    } catch (err: any) {
      this.saveError = err?.message || String(err);
      return false;
    } finally {
      this.saving = false;
      this.bump();
    }
  }

  async autosave(): Promise<void> {
    const state = this.history.state;
    if (!this.dirty || state === this.autosavedState) return;
    try {
      await call('project.autosave', { path: this.path, json: serializeProject(state) });
      this.autosavedState = state;
      this.lastAutosave = Date.now();
      this.bump();
    } catch (err) {
      console.warn('autosave failed', err);
    }
  }

  /* --------------------------------------------------------------- */
  /* Validation                                                       */
  /* --------------------------------------------------------------- */

  scheduleValidate(): void {
    clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => this.validate(), 250);
  }

  validate(): void {
    const status = new Map<string, { status: 'ok' | 'missing' | 'incompatible' | 'disabled' | 'failed'; detail?: string }>();
    for (const dep of this.project.modules) {
      const rec = this.moduleRecords.find((r) => r.manifest.id === dep.id);
      const inst = this.installed.find((m) => m.manifest.id === dep.id);
      if (!inst) status.set(dep.id, { status: 'missing' });
      else if (!inst.compatible) status.set(dep.id, { status: 'incompatible', detail: inst.problems.join('; ') });
      else if (rec && (rec.status === 'failed' || rec.status === 'faulted' || rec.status === 'dependency' || rec.status === 'invalid')) status.set(dep.id, { status: rec.status === 'dependency' ? 'missing' : 'failed', detail: rec.error });
      else status.set(dep.id, { status: 'ok' });
    }
    try {
      this.issues = validateProject(this.engine, this.project, { missingAssets: this.missingAssets, moduleStatus: status });
    } catch (err) {
      console.error('validation failed', err);
    }
    this.bump();
  }

  async refreshMissingAssets(): Promise<void> {
    try {
      const ids: string[] = await call('assets.missing', { path: this.path, assets: this.project.assets });
      this.missingAssets = new Set(ids);
      this.validate();
    } catch { /* ignore */ }
  }

  /* --------------------------------------------------------------- */
  /* Modules                                                          */
  /* --------------------------------------------------------------- */

  moduleError(moduleId: string, err: unknown, where: string): void {
    const message = err instanceof Error ? err.message : String(err);
    this.moduleErrors.push({ moduleId, message, where, time: Date.now() });
    if (this.moduleErrors.length > 100) this.moduleErrors.shift();
    console.error(`[module ${moduleId}] ${where}:`, err);
    this.bump();
  }

  /** (Re)build the engine with built-ins plus this project's enabled modules. */
  async loadModules(): Promise<void> {
    for (const r of this.moduleRecords) try { r.deactivate?.(); } catch { /* ignore */ }
    this.ext.dispose();
    this.ext = new EditorExtensions();
    this.engine = createEngine();
    this.moduleHost = new ModuleHost(this.engine, this.i18n, { mode: 'editor', onError: (id, err, where) => this.moduleError(id, err, where) });
    try {
      this.installed = await call('modules.list', { path: this.path });
    } catch (err) {
      this.installed = [];
      this.moduleError('host', err, 'list');
    }
    const sources = this.project.modules.map((dep) => {
      const inst = this.installed.find((m) => m.manifest.id === dep.id);
      return inst ? { manifest: inst.manifest, baseUrl: inst.baseUrl, locales: inst.locales, enabled: dep.enabled } : null;
    }).filter(Boolean) as any[];
    // Dependencies of enabled modules are loaded too, even if not listed explicitly.
    const need = new Set(sources.map((s: any) => s.manifest.id));
    for (const s of [...sources]) for (const dep of Object.keys(s.manifest.dependencies || {})) {
      if (need.has(dep)) continue;
      const inst = this.installed.find((m) => m.manifest.id === dep);
      if (inst) { sources.push({ manifest: inst.manifest, baseUrl: inst.baseUrl, locales: inst.locales, enabled: true }); need.add(dep); }
    }
    this.moduleRecords = await this.moduleHost.loadAll(sources);
    for (const rec of this.moduleRecords) {
      if (rec.status !== 'active' || !rec.manifest.editor) continue;
      await activateEditorModule(this, rec);
    }
    this.validate();
  }

  dispose(): void {
    clearInterval(this.autosaveTimer);
    clearInterval(this.autoSaveTimer);
    clearTimeout(this.validateTimer);
    for (const r of this.moduleRecords) try { r.deactivate?.(); } catch { /* ignore */ }
    this.ext.dispose();
    this.listeners.clear();
  }

  static async open(path: string, i18n: I18n, useRecovery: (time: string) => Promise<boolean>): Promise<{ session: ProjectSession; migrated: number | null; recovered: boolean }> {
    const r = await call('project.open', { path });
    let json = r.json as string;
    let recovered = false;
    if (r.recovery && (await useRecovery(r.recovery.time))) { json = r.recovery.json; recovered = true; }
    const { project, migratedFrom } = loadProject(json);
    const s = new ProjectSession(r.path, project, r.fileBase, i18n);
    if (recovered) s.history.commit('Recover autosave', JSON.parse(JSON.stringify(project)));
    s.missingAssets = new Set(r.missingAssets || []);
    await s.loadModules();
    return { session: s, migrated: migratedFrom, recovered };
  }
}
