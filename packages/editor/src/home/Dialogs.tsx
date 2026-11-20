import { sceneLines } from '@vne/core';
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
      <Field label={label}><input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') resolve(v.trim() || null); }} /></Field>
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

function QuickOpen() {
  const st = useStore();
  const t = useT();
  const s = st.session!;
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const items = useMemo(() => {
    const out: { label: string; sub: string; icon: string; run: () => void }[] = [];
    const query = q.trim().toLowerCase();
    for (const n of Object.values(s.project.nodes)) {
      const def = s.engine.nodeTypes.get(n.type);
      const text = n.type === 'core.scene' ? `#${(n.data as SceneData).number} ${stripMarkup(sceneLines(n.data as SceneData)[0]?.text || '')}` : '';
      const hay = `${n.name} ${text}`.toLowerCase();
      if (query && !hay.includes(query)) continue;
      out.push({ label: n.name, sub: `${s.project.chapters.find((c) => c.id === n.chapterId)?.name} · ${def ? t(def.label) : n.type}${text ? ` · ${text.slice(0, 60)}` : ''}`, icon: def?.icon || 'module', run: () => s.openNode(n.id) });
    }
    for (const c of s.project.chapters) if (!query || c.name.toLowerCase().includes(query)) out.push({ label: c.name, sub: t('chapter.label'), icon: 'book', run: () => s.setUI({ chapterId: c.id, active: 0, overview: false }) });
    for (const a of s.project.assets) if (query && a.name.toLowerCase().includes(query)) out.push({ label: a.name, sub: t('assets.title'), icon: 'image', run: () => s.setUI({ sidebar: 'assets' }) });
    return out.slice(0, 60);
  }, [q, s.project]);
  const run = (k: number) => { const it = items[k]; if (it) { st.open(null); it.run(); } };
  return (
    <div className="modal-backdrop top" onPointerDown={(e) => { if (e.target === e.currentTarget) st.open(null); }}>
      <div className="quick-open" role="dialog">
        <div className="qo-input"><Icon name="search" size={16} /><input autoFocus value={q} placeholder={t('quick.placeholder')} onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter') run(i);
            if (e.key === 'Escape') st.open(null);
          }} /></div>
        <div className="qo-list">
          {items.map((it, k) => (
            <button key={k} type="button" className={cx('qo-row', k === i && 'active')} onMouseEnter={() => setI(k)} onClick={() => run(k)}>
              <Icon name={it.icon} size={15} /><span className="qo-label">{it.label}</span><span className="muted small qo-sub">{it.sub}</span>
            </button>
          ))}
          {!items.length && <div className="muted small pad">{t('common.noResults')}</div>}
        </div>
      </div>
    </div>
  );
}

function Shortcuts() {
  const t = useT();
  const rows: [string, string][] = [
    ['Mod+S', 'shortcuts.save'], ['Mod+Z', 'shortcuts.undo'], ['Mod+Shift+Z', 'shortcuts.redo'], ['Mod+K', 'shortcuts.quickOpen'], ['Mod+P', 'shortcuts.preview'], ['Mod+E', 'shortcuts.export'],
    ['Tab', 'shortcuts.addNode'], ['Delete', 'shortcuts.delete'], ['Mod+C / Mod+V', 'shortcuts.copyPaste'], ['Mod+D', 'shortcuts.duplicate'], ['F', 'shortcuts.frame'], ['Enter', 'shortcuts.openNode'],
    ['Shift+drag', 'shortcuts.boxSelect'], ['Space+drag', 'shortcuts.pan'], ['Wheel', 'shortcuts.zoom'], ['Mod+G', 'shortcuts.group'], ['← ↑ → ↓', 'shortcuts.nudge'], [', .', 'shortcuts.keys'],
  ];
  return (
    <Modal title={t('shortcuts.title')} onClose={() => store.open(null)} width={560}>
      <div className="shortcut-grid">{rows.map(([k, l]) => <div key={k} className="shortcut-row"><Kbd>{shortcut(k)}</Kbd><span>{t(l)}</span></div>)}</div>
    </Modal>
  );
}
