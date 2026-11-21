import { hasSceneData } from '@vne/core';
import type { Issue } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { Icon } from '../ui/Icon';
import { cx, IconButton, Empty } from '../ui/controls';

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

export function ProblemsPanel({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const errors = session.issues.filter((i) => i.severity === 'error');
  const warnings = session.issues.filter((i) => i.severity === 'warning');
  const infos = session.issues.filter((i) => i.severity === 'info');
  return (
    <div className="problems-panel">
      <header>
        <h3>{t('problems.title')}</h3>
        <span className="muted small">{t('problems.summary', { e: errors.length, w: warnings.length })}</span>
        <IconButton icon="close" title={t('common.close')} onClick={() => session.setUI({ problemsOpen: false })} />
      </header>
      <div className="problems-body">
        {!session.issues.length ? <Empty icon="check" title={t('problems.none')}>{t('problems.noneText')}</Empty> : <IssueList session={session} issues={[...errors, ...warnings, ...infos]} />}
      </div>
    </div>
  );
}
