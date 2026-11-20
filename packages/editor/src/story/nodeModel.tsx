import type { Engine, Project, StoryNode, SceneData, JumpData, Issue, PortDef } from '@vne/core';
import { nodePorts, jumpOutsFor, jumpInsFor, outgoing } from '@vne/core';
import type { GNode, GEdge } from '../graph/GraphCanvas';
import { Icon } from '../ui/Icon';

export const NODE_WIDTH = 236;

export function portColor(engine: Engine, type: string): string {
  return engine.portTypes.get(type)?.color || '#9aa0b4';
}

export function nodeTypeLabel(engine: Engine, type: string, t: (k: string) => string): string {
  const def = engine.nodeTypes.get(type);
  return def ? t(def.label) : t('node.unknown');
}

function chapterName(project: Project, id: string): string {
  return project.chapters.find((c) => c.id === id)?.name || '?';
}

/** Build the visual model of a story node for the graph canvas. */
export function toGNode(engine: Engine, project: Project, n: StoryNode, t: (k: string, p?: any) => string, issues: Issue[], offset = { x: 0, y: 0 }): GNode {
  const def = engine.nodeTypes.get(n.type);
  const ports = nodePorts(engine, project, n);
  const mapPort = (p: PortDef) => ({ id: p.id, label: p.label ? t(p.label) : undefined, type: p.type, color: portColor(engine, p.type), multiple: p.multiple });
  const own = issues.filter((i) => i.target?.nodeId === n.id);
  const status = own.some((i) => i.severity === 'error') ? 'error' : own.some((i) => i.severity === 'warning') ? 'warning' : null;
  let subtitle = def ? t(def.label) : `${t('node.unknown')} · ${n.type}`;
  let body: React.ReactNode = null;
  let summary = '';
  try { summary = def?.summary ? def.summary(n, project, t) : ''; } catch { summary = ''; }
  if (n.type === 'core.scene') {
    const d = n.data as SceneData;
    subtitle = `${t('node.scene')} #${d.number}`;
    body = (
      <div className="gnode-scene">
        {summary ? <div className="gnode-summary">“{summary}”</div> : <div className="gnode-summary muted">{t('graph.emptyScene')}</div>}
        <div className="gnode-meta">
          {d.layers.length > 0 && <span title={t('scene.layers')}><Icon name="layers" size={12} /> {d.layers.length}</span>}
          {d.dialogue.length > 0 && <span title={t('scene.lines')}><Icon name="message" size={12} /> {d.dialogue.length}</span>}
          {d.scripts.length > 0 && <span title={t('scene.scripts')}><Icon name="script" size={12} /> {d.scripts.length}</span>}
          {d.animations.length > 0 && <span title={t('scene.animations')}><Icon name="timeline" size={12} /> {d.animations.length}</span>}
        </div>
      </div>
    );
  } else if (n.type === 'core.jumpIn' || n.type === 'core.jumpOut') {
    const num = (n.data as JumpData).number;
    const partners = n.type === 'core.jumpIn' ? jumpOutsFor(project, num) : jumpInsFor(project, num);
    const ok = n.type === 'core.jumpIn' ? partners.length === 1 : partners.length > 0;
    const where = partners.length === 1 ? `${chapterName(project, partners[0].chapterId)} · ${partners[0].name}` : '';
    body = (
      <div className={`gnode-jump ${ok ? 'ok' : 'bad'}`}>
        <span className="jump-num">#{num}</span>
        <span className="jump-target">
          {n.type === 'core.jumpIn'
            ? partners.length === 0 ? t('jump.noOut') : partners.length > 1 ? t('jump.ambiguous', { n: partners.length }) : `→ ${where}`
            : partners.length === 0 ? t('jump.noIn') : t('jump.fromN', { n: partners.length })}
        </span>
      </div>
    );
  } else if (n.type === 'core.comment') {
    body = <div className="gnode-comment">{(n.data as any).text || t('graph.commentHint')}</div>;
  } else if (summary) {
    body = <div className="gnode-summary">{summary}</div>;
  }
  const modulesBadge = n.modules?.length ? <span className="gnode-badge" title={t('modules.attached', { n: n.modules.length })}><Icon name="module" size={12} />{n.modules.length}</span> : null;
  return {
    id: n.id,
    x: n.x + offset.x,
    y: n.y + offset.y,
    width: n.type === 'core.comment' ? Math.max(200, (n.data as any).width || 280) : NODE_WIDTH,
    title: n.name || subtitle,
    subtitle: n.name && n.name !== subtitle ? subtitle : undefined,
    color: n.color || def?.color || '#5b6275',
    icon: def?.icon || 'module',
    inputs: ports.inputs.map(mapPort),
    outputs: ports.outputs.map(mapPort),
    body,
    status,
    badge: modulesBadge,
    className: `type-${n.type.replace(/[^a-z0-9]/gi, '-')}${!def ? ' unknown' : ''}`,
    tooltip: own.length ? own.map((i) => t(i.message, i.params)).join('\n') : undefined,
  };
}

export function toGEdges(engine: Engine, project: Project, nodeIds: Set<string>): GEdge[] {
  const out: GEdge[] = [];
  for (const e of project.edges) {
    if (!nodeIds.has(e.from.node) || !nodeIds.has(e.to.node)) continue;
    const from = project.nodes[e.from.node];
    const p = from ? nodePorts(engine, project, from).outputs.find((x) => x.id === e.from.port) : null;
    out.push({ id: e.id, from: e.from, to: e.to, color: p ? portColor(engine, p.type) : '#ef5f6b', dashed: !p });
  }
  return out;
}

/** Edges leaving the shown chapter (rendered as stubs in the inspector). */
export function crossChapterLinks(project: Project, chapterId: string): { from: StoryNode; to: StoryNode }[] {
  const out: { from: StoryNode; to: StoryNode }[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.chapterId !== chapterId) continue;
    for (const e of outgoing(project, n.id)) {
      const to = project.nodes[e.to.node];
      if (to && to.chapterId !== chapterId) out.push({ from: n, to });
    }
  }
  return out;
}
