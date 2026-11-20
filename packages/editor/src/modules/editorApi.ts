import type { Project, Recipe } from '@vne/core';
import type { ModuleRecord } from '@vne/runtime';
import type { ProjectSession } from '../state/session';

/** Context handed to every editor UI a module mounts. Documented in docs/api/editor-api.md. */
export interface MountContext {
  moduleId: string;
  /** Current project (read-only snapshot; call again for the latest). */
  project(): Project;
  /** Undoable project update. */
  update(label: string, recipe: Recipe<Project>, opts?: { mergeKey?: string }): void;
  /** Subscribe to project changes; returns unsubscribe. */
  onChange(fn: () => void): () => void;
  t(key: string, params?: Record<string, string | number>): string;
  locale(): string;
  toast(text: string, kind?: 'info' | 'error' | 'success'): void;
  /** For node workspaces / inspectors: the node and the module instance being edited. */
  nodeId?: string;
  instanceId?: string;
  layerId?: string;
  /** Instance data (node workspace) — read-only snapshot. */
  data?: Record<string, unknown>;
  /** Update instance data (node workspace), undoable. */
  setData?(patch: Record<string, unknown>, label?: string): void;
  /** Update the inspected layer's props (layer inspector), undoable. */
  setLayerProps?(patch: Record<string, unknown>, label?: string): void;
  openNode(nodeId: string): void;
  engine: any;
}

export type Mount = (el: HTMLElement, ctx: MountContext) => void | (() => void);

export interface PanelDef { id: string; moduleId: string; title: string; icon?: string; location: 'sidebar' | 'bottom'; mount: Mount }
export interface InspectorDef { id: string; moduleId: string; target: string; title?: string; mount: Mount }
export interface NodeWorkspaceDef { id: string; moduleId: string; component: string; mount: Mount }
export interface WorkspaceDef { id: string; moduleId: string; title: string; icon?: string; mount: Mount }
export interface ToolbarDef { id: string; moduleId: string; label: string; icon?: string; run(ctx: MountContext): void }
export interface ImporterDef { id: string; moduleId: string; label: string; extensions: string[]; import(files: { name: string; text?: string; base64: string }[], ctx: MountContext): void | Promise<void> }
export interface ExporterDef { id: string; moduleId: string; label: string; run(ctx: MountContext): void | Promise<void> }

/** Editor-side registries populated by module editor entry points. */
export class EditorExtensions {
  panels: PanelDef[] = [];
  inspectors: InspectorDef[] = [];
  nodeWorkspaces: NodeWorkspaceDef[] = [];
  workspaces: WorkspaceDef[] = [];
  toolbar: ToolbarDef[] = [];
  importers: ImporterDef[] = [];
  exporters: ExporterDef[] = [];
  private cleanups: (() => void)[] = [];

  addCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  dispose(): void {
    for (const f of this.cleanups) try { f(); } catch { /* ignore */ }
    this.cleanups = [];
  }
}

export function makeMountContext(session: ProjectSession, moduleId: string, extra: Partial<MountContext> = {}): MountContext {
  // Lazy import avoids a cycle with the store module.
  const st = (globalThis as any).__vneStore;
  return {
    moduleId,
    project: () => session.project,
    update: (label, recipe, opts) => session.update(label, recipe, opts),
    onChange: (fn) => session.subscribe(fn),
    t: (k, p) => session.i18n.t(k, p),
    locale: () => session.i18n.locale,
    toast: (text, kind = 'info') => st?.toast(text, kind),
    openNode: (id) => session.openNode(id),
    engine: session.engine,
    ...extra,
  };
}

/** Load a module's editor entry and call activate(editorApi). */
export async function activateEditorModule(session: ProjectSession, rec: ModuleRecord): Promise<void> {
  const id = rec.manifest.id;
  const ext = session.ext;
  const qualify = (local: string) => (local.includes('/') ? local : `${id}/${local}`);
  const reg = <T>(list: T[]) => ({
    register(def: any) {
      const full = { ...def, id: qualify(def.id), moduleId: id } as T;
      list.push(full);
      session.bump();
      return () => { const i = list.indexOf(full); if (i >= 0) list.splice(i, 1); session.bump(); };
    },
  });
  const api = Object.freeze({
    id,
    manifest: rec.manifest,
    apiVersion: '1.0.0',
    i18n: { t: (k: string, p?: any) => session.i18n.t(k, p), add: (loc: string, d: Record<string, string>) => session.i18n.add(loc, d), get locale() { return session.i18n.locale; } },
    log: { info: (...a: any[]) => console.info(`[${id}]`, ...a), warn: (...a: any[]) => console.warn(`[${id}]`, ...a), error: (...a: any[]) => session.moduleError(id, new Error(a.join(' ')), 'editor') },
    project: {
      get: () => session.project,
      update: (label: string, recipe: Recipe<Project>, opts?: any) => session.update(label, recipe, opts),
      onChange: (fn: () => void) => session.subscribe(fn),
      /** Project-level data owned by this module (project.extensions[moduleId]). */
      getData: () => (session.project.extensions?.[id] as any) ?? null,
      setData: (value: unknown, label = 'Module data') => session.update(label, (d) => { d.extensions[id] = value; }),
    },
    selection: {
      nodes: () => session.ui.selection.nodes,
      openNode: (nodeId: string) => session.openNode(nodeId),
    },
    panels: reg<PanelDef>(ext.panels),
    inspectors: reg<InspectorDef>(ext.inspectors),
    nodeWorkspaces: reg<NodeWorkspaceDef>(ext.nodeWorkspaces),
    workspaces: reg<WorkspaceDef>(ext.workspaces),
    toolbar: reg<ToolbarDef>(ext.toolbar),
    importers: reg<ImporterDef>(ext.importers),
    exporters: reg<ExporterDef>(ext.exporters),
    assetUrl: (p: string) => new URL(p.replace(/^\/+/, ''), rec.source.baseUrl).href,
    engine: session.engine,
  });
  try {
    const url = new URL(rec.manifest.editor!, rec.source.baseUrl).href;
    const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ url);
    const activate = mod.activateEditor || mod.activate || mod.default?.activateEditor || mod.default;
    if (typeof activate !== 'function') throw new Error('editor entry must export "activateEditor(api)"');
    const r = await activate(api);
    if (typeof r === 'function') ext.addCleanup(r);
  } catch (err) {
    session.moduleError(id, err, 'editor.activate');
  }
}

/** Mount module UI safely: errors show inside the host element instead of breaking the editor. */
export function safeMount(el: HTMLElement, mount: Mount, ctx: MountContext, onError: (err: unknown) => void): () => void {
  let cleanup: void | (() => void);
  try {
    cleanup = mount(el, ctx);
  } catch (err) {
    onError(err);
    el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'module-error';
    box.textContent = `${ctx.moduleId}: ${err instanceof Error ? err.message : String(err)}`;
    el.append(box);
  }
  return () => {
    try { if (typeof cleanup === 'function') cleanup(); } catch (err) { onError(err); }
    el.innerHTML = '';
  };
}
