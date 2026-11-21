import { hasSceneData } from '@vne/core';
import type { Issue } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { Icon } from '../ui/Icon';
import { cx, IconButton, useResizable } from '../ui/controls';
import { useState } from 'react';

export function goToIssue(session: ProjectSession, i: Issue): void {
  const tg = i.target;
  if (!tg) return;
  if (tg.moduleId && !tg.nodeId) { store.open({ kind: 'modules' }); return; }
  if (tg.assetId && !tg.nodeId) { session.setUI({ sidebar: 'assets' }); return; }
  if (tg.nodeId) {
    const n = session.project.nodes[tg.nodeId];
    if (!n) return;
    if (tg.layerId && hasSceneData(n)) {
      session.openNode(n.id);
      session.setSceneUI(n.id, { selectedLayers: [tg.layerId], subTab: 'composition' });
    } else session.focusNode(n.id);
  } else if (tg.chapterId) session.setUI({ chapterId: tg.chapterId, active: 0 });
}

/** Issue params may contain i18n keys (e.g. port labels); translate those that exist. */
export function translateParams(session: ProjectSession, params?: Record<string, string | number>): Record<string, string | number> | undefined {
  if (!params) return params;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === 'string' && session.i18n.has(v) ? session.i18n.t(v) : v;
  return out;
}

export function IssueList({ session, issues, limit = 200 }: { session: ProjectSession; issues: Issue[]; limit?: number }) {
  const t = session.i18n.t;
  return (
    <ul className="issue-list">
      {issues.slice(0, limit).map((i, k) => {
        const node = i.target?.nodeId ? session.project.nodes[i.target.nodeId] : null;
        return (
          <li key={k}>
            <button type="button" className={cx('issue', i.severity)} onClick={() => goToIssue(session, i)} disabled={!i.target}>
              <Icon name={i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info'} size={14} />
              <span className="issue-text">{t(i.message, translateParams(session, i.params))}</span>
              {node && <span className="issue-where">{node.name}</span>}
            </button>
          </li>
        );
      })}
      {issues.length > limit && <li className="muted small">+{issues.length - limit}</li>}
    </ul>
  );
}

type Sev = 'error' | 'warning' | 'info';

/**
 * The console: a panel that slides up from the bottom of the window (like VS Code's),
 * listing every problem grouped by where it is. Opened from the status bar.
 */
export function ProblemsPanel({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const [height, startResize] = useResizable('console', 240, 110, 640);
  const [show, setShow] = useState<Record<Sev, boolean>>({ error: true, warning: true, info: true });
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const count = (s: Sev) => session.issues.filter((i) => i.severity === s).length;
  const modProblems = session.moduleRecords.filter((r) => r.status !== 'active' && r.status !== 'disabled');
  const q = query.trim().toLowerCase();
  const text = (i: Issue) => t(i.message, translateParams(session, i.params));
  const list = session.issues.filter((i) => show[i.severity as Sev] && (!q || text(i).toLowerCase().includes(q)));
  // Group by node (or chapter / project).
  const groups = new Map<string, { label: string; icon: string; items: Issue[] }>();
  const order: Record<Sev, number> = { error: 0, warning: 1, info: 2 };
  for (const i of [...list].sort((a, b) => order[a.severity as Sev] - order[b.severity as Sev])) {
    const n = i.target?.nodeId ? session.project.nodes[i.target.nodeId] : null;
    const ch = !n && i.target?.chapterId ? session.project.chapters.find((c) => c.id === i.target!.chapterId) : null;
    const key = n ? `n:${n.id}` : ch ? `c:${ch.id}` : 'project';
    const label = n ? n.name : ch ? ch.name : t('console.project');
    const icon = n ? session.engine.nodeTypes.get(n.type)?.icon || 'scene' : ch ? 'book' : 'settings';
    if (!groups.has(key)) groups.set(key, { label, icon, items: [] });
    groups.get(key)!.items.push(i);
  }
  const close = () => session.setUI({ problemsOpen: false });
  return (
    <section className="console" style={{ height }} aria-label={t('console.title')}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <div className="console-resize" onPointerDown={(e) => startResize(e, -1, 'y')} role="separator" aria-orientation="horizontal" />
      <header className="console-head">
        <span className="console-tab active">{t('console.problems')}<span className="console-count">{session.issues.length}</span></span>
        <span className="grow" />
        {(['error', 'warning', 'info'] as Sev[]).map((s) => (
          <button key={s} type="button" className={cx('console-filter', s, show[s] && 'on')} aria-pressed={show[s]} title={t(`console.show.${s}`)} onClick={() => setShow({ ...show, [s]: !show[s] })}>
            <Icon name={s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'info'} size={12} />{count(s)}
          </button>
        ))}
        <span className="console-search"><Icon name="filter" size={12} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('console.filter')} aria-label={t('console.filter')} onKeyDown={(e) => e.stopPropagation()} /></span>
        <IconButton icon="chevronDown" size={14} title={t('console.hide')} onClick={close} />
      </header>
      <div className="console-body">
        {modProblems.length > 0 && (
          <div className="console-group">
            <div className="console-group-head"><Icon name="module" size={12} />{t('console.modules')}<span className="console-count">{modProblems.length}</span></div>
            {modProblems.map((r) => (
              <button key={r.manifest.id} type="button" className="console-row error" onClick={() => store.open({ kind: 'modules' })}>
                <Icon name="error" size={13} /><span className="console-msg">{r.manifest.name || r.manifest.id}: {r.error || r.status}</span>
              </button>
            ))}
          </div>
        )}
        {!session.issues.length && !modProblems.length && <div className="console-empty"><Icon name="check" size={14} />{t('problems.noneText')}</div>}
        {session.issues.length > 0 && !list.length && <div className="console-empty muted">{t('console.noMatch')}</div>}
        {[...groups.entries()].map(([key, g]) => {
          const open = !collapsed.has(key);
          return (
            <div key={key} className="console-group">
              <button type="button" className="console-group-head" aria-expanded={open} onClick={() => { const c = new Set(collapsed); if (open) c.add(key); else c.delete(key); setCollapsed(c); }}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /><Icon name={g.icon} size={12} />{g.label}<span className="console-count">{g.items.length}</span>
              </button>
              {open && g.items.map((i, k) => (
                <button key={k} type="button" className={cx('console-row', i.severity)} onClick={() => goToIssue(session, i)} disabled={!i.target}>
                  <Icon name={i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info'} size={13} />
                  <span className="console-msg">{text(i)}</span>
                  <span className="console-code">{i.code}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
