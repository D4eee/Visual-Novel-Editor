import { sceneChoices, hasSceneData } from '@vne/core';
import { useEffect, useRef, useState } from 'react';
import type { Asset, VarValue } from '@vne/core';
import { chapterEntry, startNode, newId } from '@vne/core';
import { GameRuntime, RuntimeError, ModuleHost, createEngine } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { Button, IconButton, Tabs, Select, cx, TextInput } from '../ui/controls';
import { Icon } from '../ui/Icon';

type Scope = 'scene' | 'chapter' | 'game';

interface LogEntry { id: string; time: number; text: string; kind: 'node' | 'event' | 'error' | 'warning' | 'log' | 'var' }

/**
 * Runs the game with the same GameRuntime used by exported games, against a
 * snapshot of the project, with a debugger beside it.
 */
export function PreviewPanel({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const p = session.ui.preview!;
  const hostRef = useRef<HTMLDivElement>(null);
  const rtRef = useRef<GameRuntime | null>(null);
  const [scope, setScope] = useState<Scope>(p.scope);
  const [run, setRun] = useState(0);
  const [tab, setTab] = useState<'state' | 'path' | 'events' | 'errors'>('state');
  const [current, setCurrent] = useState<{ id: string; name: string; type: string } | null>(null);
  const [vars, setVars] = useState<{ id: string; name: string; value: VarValue; scope: string }[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [errors, setErrors] = useState<RuntimeError[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [running, setRunning] = useState(true);

  const project = session.project;
  const resolveStart = (): string | null => {
    if (scope === 'game') return startNode(project)?.id || null;
    if (scope === 'chapter') {
      const cid = (p.nodeId && project.nodes[p.nodeId]?.chapterId) || session.ui.chapterId;
      return chapterEntry(project, cid)?.id || null;
    }
    const id = p.nodeId && project.nodes[p.nodeId] ? p.nodeId : session.currentNodeId || startNode(project)?.id || null;
    return runnableFrom(id);
  };
  /**
   * Data-only nodes (e.g. a dice roll that feeds another node) and comments cannot
   * run on their own: start at the node that consumes their output instead, or at
   * the start of the chapter.
   */
  const runnableFrom = (id: string | null): string | null => {
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = project.nodes[cur];
      if (!node) break;
      if (session.engine.nodeTypes.get(node.type)?.run) return cur;
      cur = project.edges.find((e) => e.from.node === cur)?.to.node || null;
    }
    const cid = (id && project.nodes[id]?.chapterId) || session.ui.chapterId;
    return chapterEntry(project, cid)?.id || startNode(project)?.id || null;
  };

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let rt: GameRuntime | null = null;
    setLog([]); setErrors([]); setPath([]); setRunning(true);
    const push = (e: Omit<LogEntry, 'id'>) => setLog((l) => [...l.slice(-300), { ...e, id: newId('log') }]);
    (async () => {
      // A fresh engine with the same modules, so preview never shares state with the editor.
      const engine = createEngine();
      const mh = new ModuleHost(engine, session.i18n, { mode: 'preview', onError: (id, err, where) => setErrors((x) => [...x, { source: `module:${id}`, message: `${where}: ${err instanceof Error ? err.message : String(err)}`, moduleId: id, time: 0 }]) });
      const sources = session.moduleRecords.filter((r) => r.status === 'active').map((r) => ({ ...r.source, enabled: true }));
      await mh.loadAll(sources);
      if (disposed) return;
      const snapshot = JSON.parse(JSON.stringify(session.project));
      rt = new GameRuntime({
        project: snapshot,
        engine,
        container: host,
        mode: 'preview',
        locale: session.i18n.locale,
        storageKey: `preview-${snapshot.id}`,
        resolveAssetUrl: (a: Asset) => session.assetUrl(a),
      });
      rtRef.current = rt;
      const refreshVars = () => setVars(rt!.vars.all().map((v) => ({ id: v.def.id, name: v.def.name, value: v.value as VarValue, scope: v.scope })));
      rt.debug.on('node', (e) => { setCurrent({ id: e.nodeId, name: e.name, type: e.type }); setPath([...rt!.path]); push({ time: Date.now(), text: `▶ ${e.name}`, kind: 'node' }); refreshVars(); });
      rt.debug.on('var', (e) => { refreshVars(); push({ time: Date.now(), text: `${e.name} = ${JSON.stringify(e.value)}`, kind: 'var' }); });
      rt.debug.on('block', (b) => session.markBlockRunning(b.blockId));
      rt.debug.on('event', (e) => { if (e.type !== 'var.changed') push({ time: Date.now(), text: `${e.type}${e.layerId ? ` · ${layerName(e.layerId)}` : ''}${e.choiceId ? ` · ${choiceText(e.choiceId)}` : ''}${e.animId ? ` · ${animName(e.animId)}` : ''}`, kind: 'event' }); });
      rt.debug.on('error', (e) => { setErrors((x) => [...x, e]); push({ time: Date.now(), text: `${e.source}: ${e.message}`, kind: e.detail?.severity === 'warning' ? 'warning' : 'error' }); });
      rt.debug.on('log', (e) => push({ time: Date.now(), text: e.message, kind: 'log' }));
      rt.debug.on('state', (e) => setRunning(e.running));
      refreshVars();
      const start = resolveStart();
      if (!start) { setErrors([{ source: 'preview', message: t('preview.noStart'), time: 0 }]); return; }
      rt.start(start);
      host.focus();
    })().catch((err) => setErrors((x) => [...x, { source: 'preview', message: String(err?.message || err), time: 0 }]));
    return () => { disposed = true; rt?.dispose(); rtRef.current = null; };
  }, [run, scope, p.key]);

  const layerName = (id: string) => { for (const n of Object.values(project.nodes)) if (hasSceneData(n)) { const l = (n.data as any).layers.find((x: any) => x.id === id); if (l) return l.name; } return id; };
  const choiceText = (id: string) => { for (const n of Object.values(project.nodes)) if (n.type === 'core.scene') { const c = sceneChoices(n.data as any).find((x) => x.id === id); if (c) return c.text; } return id; };
  const animName = (id: string) => { for (const n of Object.values(project.nodes)) if (hasSceneData(n)) { const a = (n.data as any).animations.find((x: any) => x.id === id); if (a) return a.name; } return id; };

  const close = () => session.setUI({ preview: null });
  const errorCount = errors.filter((e) => e.detail?.severity !== 'warning').length;

  return (
    <div className={cx('preview', p.docked && 'docked')} onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) { /* in-game Esc handled by runtime */ } }}>
      <div className="preview-bar">
        <Icon name="play" size={15} />
        <b>{t('preview.title')}</b>
        <Select value={scope} onChange={(v) => setScope(v as Scope)} options={[{ value: 'scene', label: t('preview.scope.scene') }, { value: 'chapter', label: t('preview.scope.chapter') }, { value: 'game', label: t('preview.scope.game') }]} title={t('preview.scope')} />
        <Button small icon="refresh" onClick={() => setRun((x) => x + 1)} title={t('preview.restartHint')}>{t('preview.restart')}</Button>
        {current && <button type="button" className="current-node" onClick={() => { session.focusNode(current.id); }} title={t('graph.reveal')}><span className={cx('live-dot', running && 'on')} />{current.name}</button>}
        <div className="grow" />
        <span className="muted small">{t('preview.sameRuntime')}</span>
        <IconButton icon="close" title={`${t('common.close')} (Esc)`} onClick={close} />
      </div>
      <div className="preview-main">
        <div className="preview-stage" ref={hostRef} tabIndex={0} data-preview-focus="true" />
        <aside className="preview-debug">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'state', label: t('preview.variables'), icon: 'variable' },
            { id: 'path', label: t('preview.path'), icon: 'workflow' },
            { id: 'events', label: t('preview.events'), icon: 'list' },
            { id: 'errors', label: t('preview.errors'), icon: 'bug', badge: errorCount || null },
          ]} />
          <div className="debug-body">
            {tab === 'state' && (
              <div className="var-table">
                {current && <div className="debug-current"><span className="muted small">{t('preview.activeNode')}</span><b>{current.name}</b><span className="muted small">{session.engine.nodeTypes.get(current.type) ? t(session.engine.nodeTypes.get(current.type)!.label) : current.type}</span></div>}
                {!vars.length && <div className="muted small">{t('preview.noVars')}</div>}
                {vars.map((v) => (
                  <div key={v.id} className="var-live">
                    <span className="var-name">{v.name}{v.scope !== 'game' && <span className="var-badge">{v.scope === 'scene' ? 'S' : 'P'}</span>}</span>
                    <TextInput value={String(v.value)} className="narrow" ariaLabel={v.name} onChange={(x) => {
                      const rt = rtRef.current;
                      if (!rt) return;
                      const def = rt.vars.def(v.id);
                      rt.vars.set(v.id, def?.type === 'number' ? Number(x) || 0 : def?.type === 'boolean' ? x === 'true' : x);
                    }} />
                  </div>
                ))}
              </div>
            )}
            {tab === 'path' && (
              <ol className="path-list">
                {path.map((id, i) => <li key={i}><button type="button" className="link-row" onClick={() => session.focusNode(id)}>{project.nodes[id]?.name || id}</button></li>)}
              </ol>
            )}
            {tab === 'events' && (
              <div className="event-log">
                {[...log].reverse().map((l) => <div key={l.id} className={cx('log-row', l.kind)}>{l.text}</div>)}
              </div>
            )}
            {tab === 'errors' && (
              <div className="event-log">
                {!errors.length && <div className="muted small">{t('preview.noErrors')}</div>}
                {errors.map((e, i) => (
                  <button key={i} type="button" className={cx('issue', e.detail?.severity === 'warning' ? 'warning' : 'error')} onClick={() => e.nodeId && session.focusNode(e.nodeId)}>
                    <Icon name={e.detail?.severity === 'warning' ? 'warning' : 'error'} size={14} />
                    <span className="issue-text"><b>{e.moduleId ? `${t('preview.module')} ${e.moduleId}` : e.source}</b> {e.message}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
