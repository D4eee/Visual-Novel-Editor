import { hasSceneData, GLOBAL_NODE_ID } from '@vne/core';
import { PresetManagerHost } from './effects/userPresets';
import { useEffect, useRef, useState } from 'react';
import { useStore, useSession, useT, store } from './state/store';
import type { ProjectSession } from './state/session';
import { Home } from './home/Home';
import { DialogHost } from './home/Dialogs';
import { StoryGraph } from './story/StoryGraph';
import { StoryInspector } from './story/StoryInspector';
import { SceneEditor, ModulePanelHost } from './scene/SceneEditor';
import { SceneInspector } from './scene/SceneInspector';
import { LogicWorkspace, BehaviorWorkspace } from './logic/LogicWorkspace';
import { StoryOutline } from './sidebar/StoryOutline';
import { AssetLibrary } from './sidebar/AssetLibrary';
import { DataPanel } from './sidebar/DataPanel';
import { PreviewPanel } from './preview/PreviewPanel';
import { ExportDialog } from './export/ExportDialog';
import { SettingsWindow } from './settings/SettingsWindow';
import { TourHost } from './ui/Tour';
import { TranslationsDialog } from './l10n/TranslationsDialog';
import { ImportScriptDialog } from './story/ImportScript';
import { GenerateImageDialog } from './assets/ImageGen';
import { projectLanguages, languageName } from '@vne/core';
import { ChatPanel, ChatToggle } from './ai/ChatPanel';
import { setChatOpen } from './ai/agent';
import { ModuleManager } from './modules/ModuleManager';
import { ProblemsPanel } from './problems/Problems';
import { MenuHost, openMenu, openMenuBelow, MenuItem } from './ui/Menu';
import { IconButton, Button, cx, shortcut, useResizable } from './ui/controls';
import { Icon } from './ui/Icon';
import { makeMountContext } from './modules/editorApi';
import { call } from './host';

const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function App() {
  const st = useStore();
  const t = useT();
  const s = st.session;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inText = !!(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); store.session?.save().then((ok) => ok && store.toast(t('save.saved'), 'success')); return; }
      if (mod && k === 'k') { e.preventDefault(); if (store.session) store.open({ kind: 'quickOpen' }); return; }
      if (mod && k === 'p') { e.preventDefault(); const ss = store.session; if (ss) ss.setUI({ preview: ss.ui.preview ? null : { scope: 'scene', nodeId: ss.currentNodeId, key: Date.now() } }); return; }
      if (mod && k === 'e') { e.preventDefault(); if (store.session) store.open({ kind: 'export' }); return; }
      if (mod && e.shiftKey && k === 'h') { e.preventDefault(); if (store.session) store.open({ kind: 'history' }); return; }
      if (mod && k === 'j') { e.preventDefault(); setChatOpen(!document.querySelector('.ai-panel')); return; }
      if (mod && k === ',') { e.preventDefault(); store.open({ kind: 'settings' }); return; }
      if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); store.open({ kind: 'newProject' }); return; }
      if (mod && k === 'o') { e.preventDefault(); store.pickProject(t('home.openTitle')).then((p) => { if (p) store.openProject(p); }); return; }
      if (inText || store.dialog) return;
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); const l = store.session?.history.undo(); if (l) store.toast(t('history.undid', { label: l })); return; }
      if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y')) { e.preventDefault(); const l = store.session?.history.redo(); if (l) store.toast(t('history.redid', { label: l })); return; }
      if (e.key === 'F1' || (e.key === '?' && e.shiftKey)) { e.preventDefault(); store.open({ kind: 'shortcuts' }); }
    };
    window.addEventListener('keydown', onKey);
    const off = window.vneHost?.onCommand((cmd) => {
      if (cmd === 'project.save') store.session?.save();
      if (cmd === 'project.new') store.open({ kind: 'newProject' });
      if (cmd === 'project.open') store.pickProject(t('home.openTitle')).then((p) => { if (p) store.openProject(p); });
      if (cmd === 'export.open' && store.session) store.open({ kind: 'export' });
      if (cmd === 'help.shortcuts') store.open({ kind: 'shortcuts' });
      // Edit menu: text fields get the native command; elsewhere the editor's own shortcut handlers run.
      const el = document.activeElement as HTMLElement | null;
      const inText = !!el?.closest?.('input, textarea, [contenteditable="true"]');
      const key = (k: string, shift = false) => (el || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: !isMacPlatform, metaKey: isMacPlatform, shiftKey: shift, bubbles: true, cancelable: true }));
      if (cmd === 'edit.undo') { if (inText) document.execCommand('undo'); else key('z'); }
      if (cmd === 'edit.redo') { if (inText) document.execCommand('redo'); else key('z', true); }
      if (cmd === 'edit.selectAll') { if (inText) document.execCommand('selectAll'); else key('a'); }
    });
    // Copy / cut / paste from the native menu arrive as clipboard events; route them to the
    // graph and canvas shortcut handlers when no text field is focused.
    let lastKey = 0;
    const markKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.isTrusted) lastKey = Date.now(); };
    const onClip = (kind: 'c' | 'x' | 'v') => (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el?.closest?.('input, textarea, [contenteditable="true"]') || Date.now() - lastKey < 200) return;
      e.preventDefault();
      (el || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: kind, ctrlKey: !isMacPlatform, metaKey: isMacPlatform, bubbles: true, cancelable: true }));
    };
    const copyH = onClip('c'), cutH = onClip('x'), pasteH = onClip('v');
    window.addEventListener('keydown', markKey, true);
    document.addEventListener('copy', copyH); document.addEventListener('cut', cutH); document.addEventListener('paste', pasteH);
    const beforeUnload = (e: BeforeUnloadEvent) => { if (!window.vneHost && store.sessions.some((x) => x.dirty)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey); off?.(); window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', markKey, true);
      document.removeEventListener('copy', copyH); document.removeEventListener('cut', cutH); document.removeEventListener('paste', pasteH);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="app-main">
        {s ? <SessionView key={s.id} session={s} /> : <Home />}
        <ChatPanel />
      </div>
      <PresetManagerHost session={s || null} />
      <DialogHost />
      <TourHost />
      {st.dialog?.kind === 'export' && s && <ExportDialog session={s} onClose={() => st.open(null)} />}
      {st.dialog?.kind === 'translations' && s && <TranslationsDialog session={s} onClose={() => st.open(null)} />}
      {st.dialog?.kind === 'importScript' && s && <ImportScriptDialog session={s} onClose={() => st.open(null)} />}
      {st.dialog?.kind === 'generateImage' && s && <GenerateImageDialog session={s} kind={st.dialog.imageKind} onClose={() => st.open(null)} />}
      {st.dialog?.kind === 'settings' && <SettingsWindow session={s || null} tab={st.dialog.tab} onClose={() => st.open(null)} />}
      {st.dialog?.kind === 'modules' && s && <ModuleManager session={s} onClose={() => st.open(null)} />}
      <MenuHost />
      <div className="toasts" aria-live="polite">
        {st.toasts.map((x) => (
          <div key={x.id} className={cx('toast', x.kind)}>
            <Icon name={x.kind === 'error' ? 'error' : x.kind === 'success' ? 'check' : 'info'} size={15} />
            <span className="pre-line">{x.text}</span>
            {x.action && <button type="button" className="link" onClick={x.action.run}>{x.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TopBar() {
  const st = useStore();
  const t = useT();
  const s = st.session;
  return (
    <header className="topbar">
      <button type="button" className={cx('brand', !s && 'active')} onClick={() => st.activate(-1)} title={t('home.title')}><img className="brand-icon" src="./icon.png" alt="" draggable={false} /></button>
      <div className="project-tabs" role="tablist">
        {st.sessions.map((x, i) => (
          <div key={x.id} className={cx('ptab', i === st.active && 'active')} role="tab" aria-selected={i === st.active} onClick={() => st.activate(i)} title={x.path}>
            <span className="ptab-name">{x.project.name}</span>
            {x.dirty && <span className="dirty-dot" title={t('save.unsaved')} />}
            <button type="button" className="ptab-close" onClick={(e) => { e.stopPropagation(); st.closeSession(i); }} aria-label={t('common.close')}><Icon name="close" size={12} /></button>
          </div>
        ))}
        <IconButton icon="plus" size={14} title={t('home.newOrOpen')} onClick={(e) => openMenu(e, [
          { label: t('home.new'), icon: 'plus', shortcut: shortcut('Mod+N'), onClick: () => st.open({ kind: 'newProject' }) },
          { label: t('home.open'), icon: 'folderOpen', shortcut: shortcut('Mod+O'), onClick: async () => { const p = await st.pickProject(t('home.openTitle')); if (p) await st.openProject(p); } },
          ...(window.vneHost ? [{ label: t('home.newWindow'), icon: 'external', onClick: () => window.vneHost!.newWindow() }] : []),
          { label: t('home.title'), icon: 'home', onClick: () => st.activate(-1) },
        ])} />
        <ChatToggle />
      </div>
      <div className="grow" />
      {s && <SessionActions session={s} />}
      {!s && <IconButton icon="settings" title={`${t('prefs.title')} (${shortcut('Mod+,')})`} onClick={() => st.open({ kind: 'settings' })} />}
      <IconButton icon="keyboard" title={`${t('shortcuts.title')} (F1)`} onClick={() => st.open({ kind: 'shortcuts' })} />
      <button type="button" className="lang" onClick={() => st.setLocale(st.i18n.locale === 'zh-CN' ? 'en' : 'zh-CN')} title={t('app.language')}>
        <Icon name="globe" size={14} />{st.i18n.locale === 'zh-CN' ? '中' : 'EN'}
      </button>
    </header>
  );
}

function SessionActions({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const h = session.history;
  const previewMenu = (e: React.MouseEvent) => openMenuBelow(e.currentTarget as HTMLElement, [
    { label: t('preview.scope.scene'), icon: 'scene', hint: t('preview.scope.sceneHint'), onClick: () => session.setUI({ preview: { scope: 'scene', nodeId: session.currentNodeId, key: Date.now() } }) },
    { label: t('preview.scope.chapter'), icon: 'book', onClick: () => session.setUI({ preview: { scope: 'chapter', nodeId: session.currentNodeId, key: Date.now() } }) },
    { label: t('preview.scope.game'), icon: 'flag', onClick: () => session.setUI({ preview: { scope: 'game', nodeId: null, key: Date.now() } }) },
    ...(projectLanguages(session.project).length ? [
      { separator: true } as MenuItem,
      { header: true, label: t('l10n.previewLanguage') } as MenuItem,
      ...projectLanguages(session.project).map((code, i) => ({ label: languageName(code), checked: (session.ui.previewLocale || projectLanguages(session.project)[0]) === code, onClick: () => session.setUI({ previewLocale: i === 0 ? null : code }) })),
    ] : []),
  ]);
  return (
    <div className="session-actions">
      <IconButton icon="undo" title={h.undoLabel ? `${t('history.undo')}: ${h.undoLabel} (${shortcut('Mod+Z')})` : t('history.nothingUndo')} disabled={!h.canUndo} onClick={() => h.undo()} />
      <IconButton icon="redo" title={h.redoLabel ? `${t('history.redo')}: ${h.redoLabel} (${shortcut('Mod+Shift+Z')})` : t('history.nothingRedo')} disabled={!h.canRedo} onClick={() => h.redo()} />
      <IconButton icon="clock" title={`${t('history.panel')} (${shortcut('Mod+Shift+H')})`} disabled={!h.canUndo && !h.canRedo} onClick={() => store.open({ kind: 'history' })} />
      <span className="sep" />
      {session.ext.toolbar.map((tb) => <Button key={tb.id} small kind="ghost" icon={tb.icon || 'module'} onClick={() => { try { tb.run(makeMountContext(session, tb.moduleId)); } catch (err) { session.moduleError(tb.moduleId, err, 'toolbar'); } }}>{t(tb.label)}</Button>)}
      {session.ui.preview ? (
        // While the preview runs, the same button stops it.
        <Button kind="danger" icon="stop" className="preview-stop" onClick={() => session.setUI({ preview: null })} title={`${t('preview.stop')} (${shortcut('Mod+P')})`}>{t('preview.stop')}</Button>
      ) : (
        <div className="split-btn">
          <Button kind="primary" icon="play" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId: session.currentNodeId, key: Date.now() } })} title={`${t('preview.title')} (${shortcut('Mod+P')})`}>{t('preview.button')}</Button>
          <button type="button" className="btn btn-primary split-caret" onClick={previewMenu} aria-label={t('preview.scope')}><Icon name="chevronDown" size={14} /></button>
        </div>
      )}
      <IconButton icon="languages" title={t('l10n.title')} active={!!session.project.localization} onClick={() => store.open({ kind: 'translations' })} />
      <Button icon="export" className="export-btn" onClick={() => store.open({ kind: 'export' })} title={shortcut('Mod+E')}>{t('export.button')}</Button>
      <IconButton icon="module" title={t('modules.manage')} onClick={() => store.open({ kind: 'modules' })} />
      <IconButton icon="settings" title={`${t('prefs.title')} (${shortcut('Mod+,')})`} onClick={() => store.open({ kind: 'settings' })} />
    </div>
  );
}

function SessionView({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const ui = session.ui;
  const [sideW, startSide] = useResizable('sidebar', 268, 200, 460);
  const [inspW, startInsp] = useResizable('inspector', 312, 240, 520);
  const tab = session.activeTab;
  const sidePanels = session.ext.panels.filter((p) => p.location === 'sidebar');
  const activities: { id: string; icon: string; label: string; badge?: number | null }[] = [
    { id: 'story', icon: 'book', label: t('side.story') },
    { id: 'assets', icon: 'image', label: t('side.assets'), badge: session.project.assets.filter((a) => session.missingAssets.has(a.id)).length || null },
    { id: 'data', icon: 'database', label: t('side.data') },
    ...sidePanels.map((p) => ({ id: p.id, icon: p.icon || 'module', label: t(p.title) })),
  ];
  const node = tab.kind === 'node' ? session.project.nodes[tab.nodeId] : null;
  const custom = tab.kind === 'custom' ? tab.id : null;

  // Narrow windows (or an open AI panel): the work area keeps a usable width by tucking the
  // sidebar, then the inspector, away; their buttons then open them over the work area.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [overlay, setOverlay] = useState<'side' | 'insp' | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const need = hasSceneData(node) ? 600 : 440;
  const centerW = (side: boolean, insp: boolean) => width - 46 - (side ? sideW + 4 : 0) - (insp ? inspW + 4 : 0);
  const hideSide = !!ui.sidebar && centerW(true, ui.inspectorOpen) < need;
  // A running preview (not the one docked in the canvas) also gets the inspector's room.
  const previewing = !!ui.preview && !(ui.preview.docked && hasSceneData(node) && ui.preview.nodeId === node.id);
  const hideInsp = ui.inspectorOpen && (previewing || centerW(!!ui.sidebar && !hideSide, true) < need);
  const showSide = !!ui.sidebar && (!hideSide || overlay === 'side');
  const showInsp = ui.inspectorOpen && (!hideInsp || overlay === 'insp');
  useEffect(() => { if ((overlay === 'side' && !hideSide) || (overlay === 'insp' && !hideInsp)) setOverlay(null); }, [hideSide, hideInsp, overlay]);
  useEffect(() => {
    if (!overlay) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [overlay]);
  const pickActivity = (id: string) => {
    if (hideSide || (!ui.sidebar && centerW(true, ui.inspectorOpen) < need)) {
      if (ui.sidebar === id && overlay === 'side') { setOverlay(null); return; }
      session.setUI({ sidebar: id });
      setOverlay('side');
      return;
    }
    session.setUI({ sidebar: ui.sidebar === id ? '' : id });
  };
  const toggleInspector = () => {
    if (hideInsp) { setOverlay(overlay === 'insp' ? null : 'insp'); return; }
    if (!ui.inspectorOpen && centerW(!!ui.sidebar && !hideSide, true) < need) { session.setUI({ inspectorOpen: true }); setOverlay('insp'); return; }
    session.setUI({ inspectorOpen: !ui.inspectorOpen });
  };

  return (
    <div className={cx('session', hideSide && 'side-tucked', hideInsp && 'insp-tucked')} ref={ref}>
      {overlay && <div className="panel-scrim" onPointerDown={() => setOverlay(null)} />}
      <nav className="activity" aria-label={t('side.aria')}>
        {activities.map((a) => (
          <button key={a.id} type="button" className={cx('act', ui.sidebar === a.id && (!hideSide || overlay === 'side') && 'active', ui.sidebar === a.id && hideSide && 'tucked')} onClick={() => pickActivity(a.id)} title={hideSide && ui.sidebar === a.id ? `${a.label} · ${t('layout.tucked')}` : a.label} aria-label={a.label}>
            <Icon name={a.icon} size={19} />
            {a.badge ? <span className="act-badge">{a.badge}</span> : null}
          </button>
        ))}
        <div className="grow" />
        <button type="button" className={cx('act', ui.problemsOpen && 'active')} onClick={() => session.setUI({ problemsOpen: !ui.problemsOpen })} title={t('problems.title')}>
          <Icon name="warning" size={19} />
          {session.issues.filter((i) => i.severity === 'error').length > 0 && <span className="act-badge err">{session.issues.filter((i) => i.severity === 'error').length}</span>}
        </button>
      </nav>
      {showSide && (
        <>
          <aside className={cx('sidebar', hideSide && 'floating')} style={{ width: sideW }}>
            <div className="sidebar-title">{activities.find((a) => a.id === ui.sidebar)?.label}</div>
            <div className="sidebar-body">
              {ui.sidebar === 'story' && <StoryOutline session={session} />}
              {ui.sidebar === 'assets' && <AssetLibrary session={session} />}
              {ui.sidebar === 'data' && <DataPanel session={session} />}
              {sidePanels.filter((p) => p.id === ui.sidebar).map((p) => <ModulePanelHost key={p.id} session={session} panel={p} />)}
            </div>
          </aside>
          <div className="resizer-x" onPointerDown={(e) => startSide(e, 1)} role="separator" aria-orientation="vertical" />
        </>
      )}
      <main className="center">
        <div className="ws-tabs" role="tablist">
          {ui.tabs.map((tb, i) => {
            const n = tb.kind === 'node' ? session.project.nodes[tb.nodeId] : null;
            const def = n ? session.engine.nodeTypes.get(n.type) : null;
            const beh = tb.kind === 'custom' && tb.id.startsWith('behavior:') ? session.project.behaviors.find((b) => `behavior:${b.id}` === tb.id) : null;
            const ws = tb.kind === 'custom' ? session.ext.workspaces.find((w) => w.id === tb.id) : null;
            const label = tb.kind === 'graph' ? (ui.overview ? t('graph.overview') : session.project.chapters.find((c) => c.id === ui.chapterId)?.name || t('side.story')) : n ? (n.id === GLOBAL_NODE_ID ? t('global.title') : n.name) : beh ? beh.name : ws ? t(ws.title) : '?';
            const icon = tb.kind === 'graph' ? 'workflow' : def?.icon || (beh ? 'script' : ws?.icon || 'module');
            return (
              <div key={i} role="tab" aria-selected={ui.active === i} className={cx('ws-tab', ui.active === i && 'active', tb.kind === 'graph' && 'pinned')} onClick={() => session.setUI({ active: i })}
                onAuxClick={(e) => { if (e.button === 1) session.closeTab(i); }} style={{ ['--node-color' as any]: def?.color }}>
                <Icon name={icon} size={14} />
                <span>{label}</span>
                {tb.kind !== 'graph' && <button type="button" className="ws-close" onClick={(e) => { e.stopPropagation(); session.closeTab(i); }} aria-label={t('common.close')}><Icon name="close" size={12} /></button>}
              </div>
            );
          })}
          <div className="grow" />
          {session.ext.workspaces.length > 0 && <IconButton icon="module" size={14} title={t('modules.workspaces')} onClick={(e) => openMenu(e, session.ext.workspaces.map((w) => ({ label: t(w.title), icon: w.icon || 'module', onClick: () => session.openCustom(w.id) })))} />}
          <IconButton icon={showInsp ? 'panel' : 'panelLeft'} size={15} active={hideInsp && overlay === 'insp'} title={hideInsp ? `${t('inspector.toggle')} · ${t('layout.tucked')}` : t('inspector.toggle')} onClick={toggleInspector} />
        </div>
        <div className="ws-body">
          {tab.kind === 'graph' && <StoryGraph session={session} />}
          {hasSceneData(node) && <SceneEditor key={node.id} session={session} nodeId={node.id} />}
          {node && !hasSceneData(node) && <LogicWorkspace key={node.id} session={session} nodeId={node.id} />}
          {tab.kind === 'node' && !node && <div className="pad muted">{t('workspace.nodeGone')}</div>}
          {custom?.startsWith('behavior:') && <BehaviorWorkspace session={session} behaviorId={custom.slice(9)} />}
          {custom && !custom.startsWith('behavior:') && session.ext.workspaces.filter((w) => w.id === custom).map((w) => <ModulePanelHost key={w.id} session={session} panel={{ ...w, location: 'bottom' } as any} />)}
          {ui.preview && !(ui.preview.docked && hasSceneData(node) && ui.preview.nodeId === node.id) && <PreviewPanel key={ui.preview.key} session={session} />}
        </div>
      </main>
      {showInsp && (
        <>
          <div className="resizer-x" onPointerDown={(e) => startInsp(e, -1)} role="separator" aria-orientation="vertical" />
          <aside className={cx('inspector', hideInsp && 'floating')} style={{ width: inspW }} aria-label={t('inspector.title')}>
            {hasSceneData(node) ? <SceneInspector session={session} nodeId={node.id} /> : <StoryInspector session={session} />}
          </aside>
        </>
      )}
      {ui.problemsOpen && <ProblemsPanel session={session} />}
      <StatusBar session={session} />
    </div>
  );
}

function StatusBar({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const errors = session.issues.filter((i) => i.severity === 'error').length;
  const warnings = session.issues.filter((i) => i.severity === 'warning').length;
  const modErr = session.moduleRecords.filter((r) => r.status !== 'active' && r.status !== 'disabled').length;
  return (
    <footer className="statusbar">
      <span className={cx('save-state', session.dirty ? 'dirty' : 'clean')}>
        {session.saving ? <><Icon name="refresh" size={12} /> {t('save.saving')}</> : session.saveError ? <><Icon name="error" size={12} /> {t('save.failed', { error: session.saveError })}</>
          : session.dirty ? <><span className="dirty-dot" /> {t('save.unsaved')}{session.lastAutosave ? ` · ${t('save.autosaved', { time: new Date(session.lastAutosave).toLocaleTimeString() })}` : ''}</>
            : <><Icon name="check" size={12} /> {t('save.saved')}</>}
      </span>
      {session.dirty && <button type="button" className="link" onClick={() => session.save()}>{t('save.saveNow')} ({shortcut('Mod+S')})</button>}
      <button type="button" className={cx('status-btn', errors ? 'err' : warnings ? 'warn' : 'ok')} onClick={() => session.setUI({ problemsOpen: !session.ui.problemsOpen })} title={t(session.ui.problemsOpen ? 'console.hide' : 'console.open')} aria-expanded={!!session.ui.problemsOpen}>
        <Icon name={errors ? 'error' : warnings ? 'warning' : 'check'} size={12} /> {t('problems.summary', { e: errors, w: warnings })}
        <Icon name={session.ui.problemsOpen ? 'chevronDown' : 'chevronUp'} size={11} className="status-caret" />
      </button>
      {modErr > 0 && <button type="button" className="status-btn err" onClick={() => store.open({ kind: 'modules' })}><Icon name="module" size={12} /> {t('modules.problems', { n: modErr })}</button>}
      <span className="grow" />
      <span className="muted" title={session.path}>{session.path}</span>
      {window.vneHost && <button type="button" className="link" onClick={() => call('shell.reveal', { path: session.path })}>{t('common.reveal')}</button>}
    </footer>
  );
}
