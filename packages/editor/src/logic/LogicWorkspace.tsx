import type { Behavior } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { NodeForm } from './NodeForms';
import { ModuleWorkspace } from '../modules/ModuleWorkspace';
import { Tabs, Button, TextInput } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { nodeTypeLabel } from '../story/nodeModel';
import { BlockWorkspace, WStack } from '../script/BlockEditor';

/** Detailed workspace for non-scene nodes: a logic tab adapted to the node's purpose plus the Modules tab. */
export function LogicWorkspace({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const node = session.project.nodes[nodeId];
  if (!node) return null;
  const def = session.engine.nodeTypes.get(node.type);
  const tab = session.ui.logicTab[nodeId] || 'logic';
  const chapter = session.project.chapters.find((c) => c.id === node.chapterId);
  return (
    <div className="logic-workspace">
      <div className="node-head">
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => session.setUI({ chapterId: node.chapterId, active: 0 })}><Icon name="book" size={13} />{chapter?.name}</button>
          <Icon name="chevronRight" size={12} />
          <span className="crumb current" style={{ ['--node-color' as any]: def?.color }}><Icon name={def?.icon || 'module'} size={13} />{node.name}</span>
          <span className="muted small">{nodeTypeLabel(session.engine, node.type, t)}</span>
        </div>
        <Tabs value={tab} onChange={(v) => session.setUI((ui) => ({ logicTab: { ...ui.logicTab, [nodeId]: v } }))} tabs={[
          { id: 'logic', label: t('workspace.logic'), icon: def?.icon || 'bolt' },
          { id: 'modules', label: t('workspace.modules'), icon: 'module', badge: node.modules.length || null },
        ]} />
        <div className="grow" />
        <Button small icon="workflow" kind="ghost" onClick={() => session.focusNode(nodeId)}>{t('graph.reveal')}</Button>
        <Button small icon="play" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now() } })}>{t('preview.fromHere')}</Button>
      </div>
      {tab === 'modules' ? <ModuleWorkspace session={session} nodeId={nodeId} /> : (
        <div className={node.type === 'core.event' ? 'logic-body fill' : 'logic-body'}>
          {node.type !== 'core.event' && def?.description && <p className="muted">{t(def.description)}</p>}
          <NodeForm session={session} node={node} full />
        </div>
      )}
    </div>
  );
}

export function BehaviorWorkspace({ session, behaviorId }: { session: ProjectSession; behaviorId: string }) {
  useSession(session);
  const t = useT();
  const b: Behavior | undefined = session.project.behaviors.find((x) => x.id === behaviorId);
  if (!b) return <div className="pad muted">{t('beh.missing')}</div>;
  const stacks: WStack[] = [{ id: 'body', hat: null, body: b.body, enabled: true }];
  return (
    <div className="logic-workspace">
      <div className="node-head">
        <div className="crumbs"><span className="crumb current"><Icon name="script" size={13} />{t('beh.title')}</span></div>
        <TextInput value={b.name} onChange={(v) => session.update(t('common.rename'), (d) => { d.behaviors.find((x) => x.id === behaviorId)!.name = v; })} ariaLabel={t('common.name')} />
        <div className="grow" />
        <Button small kind="ghost" icon="trash" onClick={() => { session.update(t('beh.delete'), (d) => { d.behaviors = d.behaviors.filter((x) => x.id !== behaviorId); }); session.closeTab(session.ui.active); }}>{t('common.delete')}</Button>
      </div>
      <div className="logic-body fill">
        <BlockWorkspace stacks={stacks} mode="story" selectedStack="body"
          ctx={{ project: session.project, scene: null, t, engine: session.engine, nodeId: '', storyLevel: true }}
          onChange={(recipe, label) => session.update(label, (d) => { const x = d.behaviors.find((y) => y.id === behaviorId)!; const s: WStack[] = [{ id: 'body', hat: null, body: x.body, enabled: true }]; recipe(s); x.body = s[0].body; })}
          header={<div className="blk-header muted small"><Icon name="info" size={13} /> {t('beh.hint')}</div>} />
      </div>
    </div>
  );
}
