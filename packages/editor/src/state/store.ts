import { useSyncExternalStore, useCallback, useRef } from 'react';
import { I18n, createProject, serializeProject, newId } from '@vne/core';
import { ProjectSession } from './session';
import { call, hostInfo, HostInfo } from '../host';
import { en } from '../i18n/en';
import { zhCN } from '../i18n/zh-CN';

export type StudioTab = 'rig' | 'motions' | 'expressions' | 'import';

export type Dialog =
  | { kind: 'newProject' }
  | { kind: 'openProject' }
  | { kind: 'export' }
  | { kind: 'settings'; tab?: string }
  | { kind: 'translations' }
  | { kind: 'importScript' }
  | { kind: 'generateImage'; imageKind?: 'background' | 'character' | 'other' }
  | { kind: 'modules' }
  | { kind: 'quickOpen' }
  | { kind: 'shortcuts' }
  | { kind: 'history' }
  | { kind: 'confirm'; title: string; message: string; confirm: string; cancel?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; value: string; resolve: (v: string | null) => void }
  | { kind: 'pickPath'; title: string; mode: 'folder' | 'files' | 'project'; start?: string; resolve: (p: string[] | null) => void };

export interface Toast { id: string; text: string; kind: 'info' | 'error' | 'success'; action?: { label: string; run: () => void } }

export interface Clipboard {
  kind: 'nodes' | 'layers' | 'keyframes' | 'blocks';
  data: any;
}

/** Application-wide editor state: open projects, language, dialogs, toasts and the clipboard. */
export class EditorStore {
  sessions: ProjectSession[] = [];
  active = -1;
  dialog: Dialog | null = null;
  toasts: Toast[] = [];
  clipboard: Clipboard | null = null;
  info: HostInfo | null = null;
  readonly i18n: I18n;
  private listeners = new Set<() => void>();
  version = 0;

  constructor() {
    let locale = 'en';
    try { locale = localStorage.getItem('vne.editor.locale') || (navigator.language?.startsWith('zh') ? 'zh-CN' : 'en'); } catch { /* ignore */ }
    this.i18n = new I18n(locale);
    this.i18n.add('en', en);
    this.i18n.add('zh-CN', zhCN);
    this.i18n.subscribe(() => this.bump());
    document.documentElement.lang = locale;
    window.vneHost?.setLocale?.(locale).catch(() => {});
  }

  async init(): Promise<void> {
    this.info = await hostInfo();
    this.bump();
  }

  get session(): ProjectSession | null {
    return this.sessions[this.active] || null;
  }

  t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);

  setLocale(locale: string): void {
    this.i18n.setLocale(locale);
    document.documentElement.lang = locale;
    window.vneHost?.setLocale?.(locale).catch(() => {});
    try { localStorage.setItem('vne.editor.locale', locale); } catch { /* ignore */ }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  bump(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  /* --------------------------------------------------------------- */
  /* Dialogs and notifications                                        */
  /* --------------------------------------------------------------- */

  open(d: Dialog | null): void {
    this.dialog = d;
    this.bump();
  }

  /** The Character studio (a window of its own, so confirm and prompt dialogs can open over it). */
  studio: { characterId: string; tab?: StudioTab } | null = null;
  openStudio(s: { characterId: string; tab?: StudioTab } | null): void {
    this.studio = s;
    this.bump();
  }

  confirm(title: string, message: string, confirm: string, danger = false, cancel?: string): Promise<boolean> {
    return new Promise((resolve) => this.open({ kind: 'confirm', title, message, confirm, cancel, danger, resolve: (ok) => { this.open(null); resolve(ok); } }));
  }

  prompt(title: string, label: string, value = ''): Promise<string | null> {
    return new Promise((resolve) => this.open({ kind: 'prompt', title, label, value, resolve: (v) => { this.open(null); resolve(v); } }));
  }

  async pickFolder(title: string, start?: string): Promise<string | null> {
    const info = this.info || (await hostInfo());
    if (info.nativeDialogs) return call('dialog.pickFolder', { title, defaultPath: start });
    return new Promise((resolve) => this.open({ kind: 'pickPath', title, mode: 'folder', start, resolve: (p) => { this.open(null); resolve(p?.[0] || null); } }));
  }

  async pickProject(title: string): Promise<string | null> {
    const info = this.info || (await hostInfo());
    if (info.nativeDialogs) return call('dialog.pickFolder', { title });
    return new Promise((resolve) => this.open({ kind: 'pickPath', title, mode: 'project', resolve: (p) => { this.open(null); resolve(p?.[0] || null); } }));
  }

  async pickFiles(title: string, filters?: { name: string; extensions: string[] }[]): Promise<string[]> {
    const info = this.info || (await hostInfo());
    if (info.nativeDialogs) return (await call('dialog.pickFiles', { title, filters })) || [];
    return new Promise((resolve) => this.open({ kind: 'pickPath', title, mode: 'files', resolve: (p) => { this.open(null); resolve(p || []); } }));
  }

  toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
    const t: Toast = { id: newId('tst'), text, kind, action };
    this.toasts = [...this.toasts, t];
    this.bump();
    setTimeout(() => { this.toasts = this.toasts.filter((x) => x !== t); this.bump(); }, kind === 'error' ? 8000 : 3500);
  }

  /* --------------------------------------------------------------- */
  /* Projects                                                         */
  /* --------------------------------------------------------------- */

  async openProject(path: string): Promise<ProjectSession | null> {
    const existing = this.sessions.findIndex((s) => s.path === path);
    if (existing >= 0) { this.active = existing; this.bump(); return this.sessions[existing]; }
    try {
      const { session, migrated, recovered } = await ProjectSession.open(path, this.i18n, (time) =>
        this.confirm(this.t('recover.title'), this.t('recover.message', { time: new Date(time).toLocaleString() }), this.t('recover.use'), false, this.t('recover.keepSaved')));
      session.subscribe(() => this.bump());
      this.sessions = [...this.sessions, session];
      this.active = this.sessions.length - 1;
      this.bump();
      if (migrated !== null) this.toast(this.t('project.migrated', { from: migrated }), 'info');
      if (recovered) this.toast(this.t('recover.done'), 'success');
      const failed = session.moduleRecords.filter((r) => r.status !== 'active' && r.status !== 'disabled');
      if (failed.length) this.toast(this.t('modules.someFailed', { n: failed.length }), 'error', { label: this.t('modules.open'), run: () => this.open({ kind: 'modules' }) });
      return session;
    } catch (err: any) {
      this.toast(this.t('project.openFailed', { error: err?.message || String(err) }), 'error');
      return null;
    }
  }

  async createProject(dir: string, name: string, template?: string): Promise<ProjectSession | null> {
    try {
      const p = createProject(name);
      p.chapters[0].name = this.t('defaults.firstChapter');
      if (!template) {
        // A minimal but runnable starting point: Start → first scene → ending (no open ends).
        const { createNode, connect, nodePorts } = await import('@vne/core');
        const { createEngine } = await import('@vne/runtime');
        const engine = createEngine();
        const ch = p.chapters[0].id;
        const start = createNode(engine, p, 'core.start', ch, 80, 200, this.t('defaults.start'));
        p.nodes[start.id] = start;
        const scene = createNode(engine, p, 'core.scene', ch, 360, 160, this.t('defaults.firstScene'));
        p.nodes[scene.id] = scene;
        connect(engine, p, { node: start.id, port: 'out' }, { node: scene.id, port: 'in' });
        const end = createNode(engine, p, 'core.ending', ch, 680, 200, this.t('defaults.ending'));
        p.nodes[end.id] = end;
        const out = nodePorts(engine, p, scene).outputs[0];
        const inp = nodePorts(engine, p, end).inputs[0];
        if (out && inp) connect(engine, p, { node: scene.id, port: out.id }, { node: end.id, port: inp.id });
      }
      await call('project.create', { dir, json: serializeProject(p), template });
      return this.openProject(dir);
    } catch (err: any) {
      this.toast(this.t('project.createFailed', { error: err?.message || String(err) }), 'error');
      return null;
    }
  }

  async closeSession(i: number): Promise<void> {
    const s = this.sessions[i];
    if (!s) return;
    if (s.dirty) {
      const ok = await this.confirm(this.t('close.unsavedTitle'), this.t('close.unsavedMessage', { name: s.project.name }), this.t('close.discard'), true);
      if (!ok) return;
    }
    await call('project.clearAutosave', { path: s.path }).catch(() => {});
    s.dispose();
    this.sessions = this.sessions.filter((_, j) => j !== i);
    this.active = Math.min(this.active, this.sessions.length - 1);
    this.bump();
  }

  activate(i: number): void {
    this.active = i;
    this.bump();
  }
}

export const store = new EditorStore();

/** Re-render when the editor store or the active session changes. */
export function useStore(): EditorStore {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}

export function useT(): EditorStore['t'] {
  useSyncExternalStore(store.subscribe, () => store.i18n.locale);
  return store.t;
}

/** Subscribe to a session; re-renders when it changes. */
export function useSession(s: ProjectSession): ProjectSession {
  const sub = useCallback((fn: () => void) => s.subscribe(fn), [s]);
  useSyncExternalStore(sub, () => s.version);
  return s;
}

/** Keep a stable reference to the latest value inside event handlers. */
export function useLatest<T>(v: T): { current: T } {
  const r = useRef(v);
  r.current = v;
  return r;
}
