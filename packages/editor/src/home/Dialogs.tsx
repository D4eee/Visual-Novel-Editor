import { sceneLines, createNode, nextSceneNumber } from '@vne/core';
import { setChatOpen } from '../ai/agent';
import { startTour } from '../ui/Tour';
import { useEffect, useMemo, useState } from 'react';
import type { SceneData } from '@vne/core';
import { stripMarkup } from '@vne/runtime';
import { useStore, useT, store } from '../state/store';
import { call, joinPath, baseName } from '../host';
import { Modal } from '../ui/Modal';
import { Button, Field, TextInput, Kbd, cx, shortcut } from '../ui/controls';
import { Icon } from '../ui/Icon';

export function DialogHost() {
  const st = useStore();
  const d = st.dialog;
  const session = st.session;
  if (!d) return null;
  switch (d.kind) {
    case 'confirm': return <ConfirmDialog {...d} />;
    case 'prompt': return <PromptDialog {...d} />;
    case 'pickPath': return <PathPicker {...d} />;
    case 'newProject': return <NewProjectDialog template={(d as any).template} name={(d as any).name} />;
    case 'quickOpen': return session ? <QuickOpen /> : null;
    case 'shortcuts': return <Shortcuts />;
    case 'history': return session ? <HistoryDialog /> : null;
    default: return null;
  }
}

function ConfirmDialog({ title, message, confirm, cancel, danger, resolve }: { title: string; message: string; confirm: string; cancel?: string; danger?: boolean; resolve: (ok: boolean) => void }) {
  const t = useT();
  return (
    <Modal title={title} onClose={() => resolve(false)} width={440} footer={<><div className="grow" /><Button onClick={() => resolve(false)}>{cancel || t('common.cancel')}</Button><Button kind={danger ? 'danger' : 'primary'} onClick={() => resolve(true)} autoFocus>{confirm}</Button></>}>
      <p className="pre-line">{message}</p>
    </Modal>
  );
}

function PromptDialog({ title, label, value, resolve }: { title: string; label: string; value: string; resolve: (v: string | null) => void }) {
  const t = useT();
  const [v, setV] = useState(value);
  return (
    <Modal title={title} onClose={() => resolve(null)} width={420} footer={<><div className="grow" /><Button onClick={() => resolve(null)}>{t('common.cancel')}</Button><Button kind="primary" onClick={() => resolve(v.trim() || null)}>{t('common.ok')}</Button></>}>
      <Field label={label}><input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); resolve(v.trim() || null); } }} /></Field>
    </Modal>
  );
}

/** In-app folder browser used in browser mode (no native dialogs). */
function PathPicker({ title, mode, start, resolve }: { title: string; mode: 'folder' | 'files' | 'project'; start?: string; resolve: (p: string[] | null) => void }) {
  const t = useT();
  const [dir, setDir] = useState<{ path: string; parent: string | null; entries: { name: string; dir: boolean }[]; isProject: boolean } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');
  const go = async (p?: string) => { try { const r = await call('fs.listDir', { path: p || start || store.info?.home }); setDir(r); setTyped(r.path); setSel(new Set()); } catch (err: any) { store.toast(err.message, 'error'); } };
  useEffect(() => { go(); }, []);
  const choose = () => {
    if (!dir) return;
    if (mode === 'files') resolve([...sel].map((n) => joinPath(dir.path, n)));
    else resolve([dir.path]);
  };
  return (
    <Modal title={title} onClose={() => resolve(null)} width={620} footer={<>
      <span className="muted small">{mode === 'project' ? (dir?.isProject ? t('picker.isProject') : t('picker.notProject')) : mode === 'files' ? t('picker.selected', { n: sel.size }) : ''}</span>
      <div className="grow" />
      <Button onClick={() => resolve(null)}>{t('common.cancel')}</Button>
      {mode === 'folder' && <Button icon="plus" onClick={async () => { const n = await new Promise<string | null>((res) => { const v = prompt(t('picker.newFolder')); res(v); }); if (n && dir) { await call('fs.mkdir', { path: joinPath(dir.path, n) }); go(joinPath(dir.path, n)); } }}>{t('picker.newFolder')}</Button>}
      <Button kind="primary" onClick={choose} disabled={!dir || (mode === 'project' && !dir.isProject) || (mode === 'files' && !sel.size)}>{mode === 'files' ? t('picker.chooseFiles') : mode === 'project' ? t('picker.openProject') : t('picker.chooseFolder')}</Button>
    </>}>
      <div className="row-inline">
        <Button small icon="arrowUp" disabled={!dir?.parent} onClick={() => dir?.parent && go(dir.parent)} title={t('picker.up')} />
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(typed); }} aria-label={t('picker.path')} />
        <Button small onClick={() => go(typed)}>{t('picker.go')}</Button>
      </div>
      <div className="picker-list">
        {dir?.entries.map((e) => (
          <button key={e.name} type="button" className={cx('picker-row', sel.has(e.name) && 'active', !e.dir && mode !== 'files' && 'disabled')}
            onClick={() => { if (e.dir) { if (mode === 'files') go(joinPath(dir.path, e.name)); else setSel(new Set([e.name])); } else if (mode === 'files') { const s = new Set(sel); if (s.has(e.name)) s.delete(e.name); else s.add(e.name); setSel(s); } }}
            onDoubleClick={() => e.dir && go(joinPath(dir.path, e.name))}>
            <Icon name={e.dir ? 'folder' : 'file'} size={15} /><span>{e.name}</span>
          </button>
        ))}
        {dir && !dir.entries.length && <div className="muted small pad">{t('picker.empty')}</div>}
      </div>
    </Modal>
  );
}

function NewProjectDialog({ template, name: initialName }: { template?: string; name?: string }) {
  const st = useStore();
  const t = useT();
  const [name, setName] = useState(initialName ? `${initialName}` : t('project.defaultName'));
  const [parent, setParent] = useState(() => localStorage.getItem('vne.lastParent') || joinPath(st.info?.home || '', 'Visual Novels'));
  const [busy, setBusy] = useState(false);
  const folder = joinPath(parent, name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Project');
  const create = async () => {
    setBusy(true);
    localStorage.setItem('vne.lastParent', parent);
    const s = await st.createProject(folder, name.trim() || 'Project', template);
    setBusy(false);
    if (s) st.open(null);
  };
  return (
    <Modal title={template ? t('project.fromExample', { name: initialName || baseName(template) }) : t('project.new')} onClose={() => st.open(null)} width={520}
      footer={<><div className="grow" /><Button onClick={() => st.open(null)}>{t('common.cancel')}</Button><Button kind="primary" onClick={create} disabled={busy || !name.trim()}>{t('project.create')}</Button></>}>
      <Field label={t('project.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} /></Field>
      <Field label={t('project.location')}>
        <div className="row-inline">
          <input className="input" value={parent} onChange={(e) => setParent(e.target.value)} />
          <Button small icon="folderOpen" onClick={async () => { const p = await st.pickFolder(t('project.location'), parent); if (p) setParent(p); }}>{t('common.browse')}</Button>
        </div>
      </Field>
      <div className="muted small">{t('project.willCreate')} <code>{folder}</code></div>
    </Modal>
  );
}

/**
 * Command palette (Mod+K): go to scenes, chapters, elements, characters and assets, or run
 * a command. Typing ">" first lists only commands.
 */
function QuickOpen() {
  const st = useStore();
  const t = useT();
  const s = st.session!;
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const commands = useMemo(() => paletteCommands(s, t), [s, t]);
  const items = useMemo(() => {
    const out: { label: string; sub: string; icon: string; run: () => void; kind?: string }[] = [];
    const cmdOnly = q.trimStart().startsWith('>');
    const query = q.replace(/^\s*>/, '').trim().toLowerCase();
    const match = (...parts: string[]) => !query || parts.join(' ').toLowerCase().includes(query);
    for (const c of commands) if (match(c.label, c.keywords || '')) out.push({ label: c.label, sub: c.shortcut ? shortcut(c.shortcut) : t('palette.command'), icon: c.icon, run: c.run, kind: 'cmd' });
    if (cmdOnly) return out;
    // Without a query, places come first; with one, commands that match lead.
    const places: typeof out = [];
    for (const n of Object.values(s.project.nodes)) {
      const def = s.engine.nodeTypes.get(n.type);
      const text = n.type === 'core.scene' ? `#${(n.data as SceneData).number} ${stripMarkup(sceneLines(n.data as SceneData)[0]?.text || '')}` : '';
      if (!match(n.name, text)) continue;
      places.push({ label: n.name, sub: `${s.project.chapters.find((c) => c.id === n.chapterId)?.name} · ${def ? t(def.label) : n.type}${text ? ` · ${text.slice(0, 60)}` : ''}`, icon: def?.icon || 'module', run: () => s.openNode(n.id) });
    }
    for (const c of s.project.chapters) if (match(c.name)) places.push({ label: c.name, sub: t('chapter.label'), icon: 'book', run: () => s.setUI({ chapterId: c.id, active: 0, overview: false }) });
    if (query) {
      for (const n of Object.values(s.project.nodes)) {
        const layers: any[] = (n.data as any)?.layers || [];
        for (const l of layers) if (match(l.name)) places.push({ label: l.name, sub: `${t('palette.element')} · ${n.name}`, icon: s.engine.layerTypes.get(l.type)?.icon || 'layers', run: () => { s.openNode(n.id); s.setSceneUI(n.id, { selectedLayers: [l.id], subTab: 'composition' }); } });
      }
      for (const c of s.project.characters) if (match(c.name)) places.push({ label: c.name, sub: t('palette.character'), icon: 'user', run: () => s.setUI({ sidebar: 'data' }) });
      for (const a of s.project.assets) if (match(a.name)) places.push({ label: a.name, sub: t('assets.title'), icon: 'image', run: () => s.setUI({ sidebar: 'assets' }) });
    }
    return query ? [...out, ...places].slice(0, 80) : [...places.slice(0, 40), ...out];
  }, [q, s.project, commands]);
  const run = (k: number) => { const it = items[k]; if (it) { st.open(null); it.run(); } };
  return (
    <div className="modal-backdrop top" onPointerDown={(e) => { if (e.target === e.currentTarget) st.open(null); }}>
      <div className="quick-open" role="dialog" aria-label={t('palette.title')}>
        <div className="qo-input"><Icon name="search" size={16} /><input autoFocus value={q} placeholder={t('palette.placeholder')} onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter') run(i);
            if (e.key === 'Escape') st.open(null);
          }} /></div>
        <div className="qo-list">
          {items.map((it, k) => (
            <button key={k} type="button" className={cx('qo-row', k === i && 'active', it.kind === 'cmd' && 'cmd')} onMouseEnter={() => setI(k)} onClick={() => run(k)} ref={k === i ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
              <Icon name={it.icon} size={15} /><span className="qo-label">{it.label}</span><span className="muted small qo-sub">{it.sub}</span>
            </button>
          ))}
          {!items.length && <div className="muted small pad">{t('common.noResults')}</div>}
        </div>
        <div className="qo-foot muted small">{t('palette.foot')}</div>
      </div>
    </div>
  );
}

interface PaletteCommand { label: string; icon: string; run: () => void; shortcut?: string; keywords?: string }

function paletteCommands(s: NonNullable<ReturnType<typeof useStore>['session']>, t: (k: string, p?: any) => string): PaletteCommand[] {
  const scene = s.currentNodeId && s.project.nodes[s.currentNodeId]?.type === 'core.scene' ? s.currentNodeId : null;
  const list: PaletteCommand[] = [
    { label: t('palette.newScene'), icon: 'scene', keywords: 'add scene node', run: () => addSceneFromPalette(s, t) },
    { label: t('import.title'), icon: 'fileText', keywords: 'script import', run: () => store.open({ kind: 'importScript' }) },
    { label: `${t('preview.title')}: ${t('preview.scope.scene')}`, icon: 'play', shortcut: 'Mod+P', keywords: 'preview play run', run: () => s.setUI({ preview: { scope: 'scene', nodeId: s.currentNodeId, key: Date.now() } }) },
    { label: `${t('preview.title')}: ${t('preview.scope.chapter')}`, icon: 'play', keywords: 'preview play', run: () => s.setUI({ preview: { scope: 'chapter', nodeId: null, key: Date.now() } }) },
    { label: `${t('preview.title')}: ${t('preview.scope.game')}`, icon: 'flag', keywords: 'preview play', run: () => s.setUI({ preview: { scope: 'game', nodeId: null, key: Date.now() } }) },
    { label: t('export.button'), icon: 'export', shortcut: 'Mod+E', keywords: 'build publish', run: () => store.open({ kind: 'export' }) },
    { label: t('l10n.title'), icon: 'languages', keywords: 'translate language', run: () => store.open({ kind: 'translations' }) },
    { label: t('imggen.title'), icon: 'imagePlus', keywords: 'image ai background', run: () => store.open({ kind: 'generateImage' }) },
    { label: t('ai.title'), icon: 'sparkles', shortcut: 'Mod+J', keywords: 'assistant chat', run: () => setChatOpen(true) },
    { label: t('history.panel'), icon: 'clock', keywords: 'undo redo history', run: () => store.open({ kind: 'history' }) },
    { label: t('modules.manage'), icon: 'module', keywords: 'extensions plugins', run: () => store.open({ kind: 'modules' }) },
    { label: t('prefs.title'), icon: 'settings', shortcut: 'Mod+,', keywords: 'settings preferences', run: () => store.open({ kind: 'settings' }) },
    { label: `${t('prefs.title')}: ${t('prefs.tab.ai')}`, icon: 'bot', keywords: 'api key model', run: () => store.open({ kind: 'settings', tab: 'ai' }) },
    { label: `${t('prefs.title')}: ${t('prefs.tab.images')}`, icon: 'imagePlus', keywords: 'api key', run: () => store.open({ kind: 'settings', tab: 'images' }) },
    { label: t('shortcuts.title'), icon: 'keyboard', shortcut: 'F1', run: () => store.open({ kind: 'shortcuts' }) },
    { label: t('tour.replay'), icon: 'help', keywords: 'tour help guide', run: () => startTour() },
    { label: t('graph.overview'), icon: 'book', keywords: 'all chapters story', run: () => s.setUI({ overview: true, active: 0 }) },
    { label: t('problems.title'), icon: 'warning', keywords: 'errors warnings', run: () => s.setUI({ problemsOpen: true }) },
    { label: t('save.saveNow'), icon: 'check', shortcut: 'Mod+S', run: () => { s.save(); } },
  ];
  if (scene) list.push(
    { label: t('palette.sceneScript'), icon: 'fileText', keywords: 'script dialogue text', run: () => s.setSceneUI(scene, { subTab: 'script' }) },
    { label: t('palette.sceneCanvas'), icon: 'layers', keywords: 'composition canvas', run: () => s.setSceneUI(scene, { subTab: 'composition' }) },
  );
  return list;
}

function addSceneFromPalette(s: NonNullable<ReturnType<typeof useStore>['session']>, t: (k: string, p?: any) => string): void {
  let id = '';
  s.update(t('graph.addNode'), (d) => {
    const ch = s.ui.chapterId || d.chapters[0].id;
    const nodes = Object.values(d.nodes).filter((n) => n.chapterId === ch);
    const n = createNode(s.engine, d, 'core.scene', ch, nodes.length ? Math.max(...nodes.map((x) => x.x)) + 320 : 120, nodes.length ? Math.min(...nodes.map((x) => x.y)) : 120);
    (n.data as SceneData).number = nextSceneNumber(d);
    d.nodes[n.id] = n;
    id = n.id;
  });
  if (id) s.openNode(id);
}

/** Every step since the project was opened; click one to go back (or forward) to it. */
function HistoryDialog() {
  const st = useStore();
  const t = useT();
  const s = st.session!;
  const [, force] = useState(0);
  useEffect(() => s.history.subscribe(() => force((x) => x + 1)), [s]);
  const { past, future } = s.history.steps();
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const rows: { label: string; time: number; at: number; state: 'past' | 'now' | 'future' }[] = [
    ...future.slice().reverse().map((e, k) => ({ ...e, at: future.length - k, state: 'future' as const })),
    { label: t('history.now'), time: Date.now(), at: 0, state: 'now' as const },
    ...past.slice().reverse().map((e, k) => ({ ...e, at: -(k + 1), state: 'past' as const })),
  ];
  return (
    <Modal title={t('history.panel')} icon={<Icon name="clock" size={16} />} onClose={() => st.open(null)} width={480}
      footer={<><span className="muted small">{t('history.panelHint')}</span><div className="grow" /><Button onClick={() => st.open(null)}>{t('common.close')}</Button></>}>
      <div className="history-list">
        {rows.map((r, k) => (
          <button key={k} type="button" className={cx('history-row', r.state)} disabled={r.state === 'now'} onClick={() => s.history.go(r.at)}
            title={r.state === 'now' ? undefined : r.at < 0 ? t('history.goBack', { n: -r.at }) : t('history.goForward', { n: r.at })}>
            <Icon name={r.state === 'future' ? 'redo' : r.state === 'now' ? 'check' : /^✦|^AI/.test(r.label) ? 'sparkles' : 'undo'} size={13} />
            <span className="history-label">{r.label}</span>
            {r.state !== 'now' && <span className="muted small">{time(r.time)}</span>}
          </button>
        ))}
        {!past.length && !future.length && <div className="muted small pad">{t('history.empty')}</div>}
      </div>
    </Modal>
  );
}

function Shortcuts() {
  const t = useT();
  const rows: [string, string][] = [
    ['Mod+S', 'shortcuts.save'], ['Mod+Z', 'shortcuts.undo'], ['Mod+Shift+Z', 'shortcuts.redo'], ['Mod+Shift+H', 'shortcuts.history'], ['Mod+K', 'shortcuts.quickOpen'], ['Mod+P', 'shortcuts.preview'], ['Mod+E', 'shortcuts.export'],
    ['Tab', 'shortcuts.addNode'], ['Delete', 'shortcuts.delete'], ['Mod+C / Mod+V', 'shortcuts.copyPaste'], ['Mod+D', 'shortcuts.duplicate'], ['F', 'shortcuts.frame'], ['Enter', 'shortcuts.openNode'],
    ['Shift+drag', 'shortcuts.boxSelect'], ['Space+drag', 'shortcuts.pan'], ['Wheel', 'shortcuts.zoom'], ['Mod+G', 'shortcuts.group'], ['← ↑ → ↓', 'shortcuts.nudge'], [', .', 'shortcuts.keys'], ['Mod+\\', 'shortcuts.focusCanvas'],
  ];
  return (
    <Modal title={t('shortcuts.title')} onClose={() => store.open(null)} width={560}>
      <div className="shortcut-grid">{rows.map(([k, l]) => <div key={k} className="shortcut-row"><Kbd>{shortcut(k)}</Kbd><span>{t(l)}</span></div>)}</div>
    </Modal>
  );
}
