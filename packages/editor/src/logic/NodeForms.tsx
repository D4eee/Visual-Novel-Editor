import type { StoryNode, ConditionData, RandomData, WaitData, EndingData, JumpData, CommentData, EventData, SceneData } from '@vne/core';
import { newId, jumpOutsFor, jumpInsFor } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { Field, NumberInput, TextInput, Select, Button, IconButton } from '../ui/controls';
import { ExprInput } from '../script/ExprInput';
import { BlockWorkspace, WStack } from '../script/BlockEditor';
import { PropEditor } from '../inspect/PropEditor';
import { Icon } from '../ui/Icon';

/** Type-specific editing for logic nodes. `full` is the dedicated workspace (larger editors). */
export function NodeForm({ session, node, full }: { session: ProjectSession; node: StoryNode; full?: boolean }) {
  const t = session.i18n.t;
  const project = session.project;
  const upd = (label: string, fn: (d: any) => void, mergeKey?: string) => session.update(label, (draft) => { const n = draft.nodes[node.id]; if (n) fn(n.data); }, mergeKey ? { mergeKey } : undefined);
  const exprCtx = { project, scene: null, t };

  switch (node.type) {
    case 'core.condition': {
      const d = node.data as ConditionData;
      return (
        <div className="node-form">
          <Field label={t('condition.if')} wide hint={t('condition.hint')}>
            <ExprInput value={d.expr} ctx={exprCtx} placeholder={t('condition.add')} onChange={(e) => upd(t('condition.edit'), (x) => { x.expr = e; })} />
          </Field>
          <div className="port-legend"><span className="dot true" />{t('port.true')} <span className="dot false" />{t('port.false')}</div>
        </div>
      );
    }
    case 'core.random': {
      const d = node.data as RandomData;
      const total = d.branches.reduce((s, b) => s + Math.max(0, b.weight), 0) || 1;
      return (
        <div className="node-form">
          {d.branches.map((b, i) => (
            <div className="row-inline" key={b.id}>
              <TextInput value={b.label} onChange={(v) => upd(t('random.edit'), (x) => { x.branches[i].label = v; })} ariaLabel={t('random.label')} />
              <NumberInput value={b.weight} min={0} step={1} onChange={(v) => upd(t('random.edit'), (x) => { x.branches[i].weight = v; }, `w-${b.id}`)} label={t('random.weight')} />
              <span className="muted small pct">{Math.round((Math.max(0, b.weight) / total) * 100)}%</span>
              <IconButton icon="trash" size={14} title={t('common.delete')} disabled={d.branches.length <= 1} onClick={() => session.update(t('random.remove'), (draft) => {
                const x = draft.nodes[node.id].data as RandomData;
                x.branches.splice(i, 1);
                draft.edges = draft.edges.filter((e) => !(e.from.node === node.id && e.from.port === b.id));
              })} />
            </div>
          ))}
          <Button small icon="plus" onClick={() => upd(t('random.add'), (x) => { x.branches.push({ id: newId('br'), label: String.fromCharCode(65 + x.branches.length), weight: 1 }); })}>{t('random.add')}</Button>
        </div>
      );
    }
    case 'core.wait': {
      const d = node.data as WaitData;
      return <div className="node-form"><Field label={t('wait.seconds')}><NumberInput value={d.seconds} min={0} step={0.1} unit="s" onChange={(v) => upd(t('wait.edit'), (x) => { x.seconds = v; }, 'wait')} /></Field></div>;
    }
    case 'core.ending': {
      const d = node.data as EndingData;
      return (
        <div className="node-form">
          <Field label={t('ending.label')}><TextInput value={d.label} onChange={(v) => upd(t('ending.edit'), (x) => { x.label = v; })} /></Field>
          <Field label={t('ending.message')}><TextInput multiline value={d.message} onChange={(v) => upd(t('ending.edit'), (x) => { x.message = v; })} /></Field>
          <Field label={t('ending.after')}>
            <Select value={d.behavior} options={[{ value: 'title', label: t('ending.toTitle') }, { value: 'restart', label: t('ending.restart') }, { value: 'quit', label: t('ending.quit') }]} onChange={(v) => upd(t('ending.edit'), (x) => { x.behavior = v; })} />
          </Field>
          <Field label={t('ending.unlock')} hint={t('ending.unlockHint')}>
            <Select value={d.unlockVarId || ''} options={[{ value: '', label: t('common.none') }, ...project.variables.filter((v) => v.scope === 'persistent').map((v) => ({ value: v.id, label: v.name }))]} onChange={(v) => upd(t('ending.edit'), (x) => { x.unlockVarId = v || null; })} />
          </Field>
        </div>
      );
    }
    case 'core.jumpIn':
    case 'core.jumpOut': {
      const d = node.data as JumpData;
      const partners = node.type === 'core.jumpIn' ? jumpOutsFor(project, d.number) : jumpInsFor(project, d.number);
      return (
        <div className="node-form">
          <Field label={t('jump.number')} hint={node.type === 'core.jumpIn' ? t('jump.inHint') : t('jump.outHint')}>
            <NumberInput value={d.number} min={0} step={1} onChange={(v) => upd(t('jump.edit'), (x) => { x.number = Math.round(v); }, 'jump')} />
          </Field>
          <div className="jump-partners">
            {partners.length === 0 && <div className="issue warning"><Icon name="warning" size={14} />{node.type === 'core.jumpIn' ? t('jump.noOut') : t('jump.noIn')}</div>}
            {node.type === 'core.jumpIn' && partners.length > 1 && <div className="issue error"><Icon name="error" size={14} />{t('jump.ambiguous', { n: partners.length })}</div>}
            {partners.map((p) => (
              <button key={p.id} type="button" className="link-row" onClick={() => session.focusNode(p.id)}>
                <Icon name={p.type === 'core.jumpIn' ? 'jumpIn' : 'jumpOut'} size={14} />
                <span>{project.chapters.find((c) => c.id === p.chapterId)?.name} · {p.name}</span>
                <Icon name="arrowRight" size={14} />
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'core.comment': {
      const d = node.data as CommentData;
      return <div className="node-form"><Field label={t('comment.text')} wide><TextInput multiline rows={5} value={d.text} onChange={(v) => upd(t('comment.edit'), (x) => { x.text = v; })} /></Field></div>;
    }
    case 'core.event': {
      const d = node.data as EventData;
      if (!full) {
        return (
          <div className="node-form">
            <div className="muted small">{d.actions.length ? t('event.actionsCount', { n: d.actions.length }) : t('event.noActions')}</div>
            <Button kind="primary" icon="script" onClick={() => session.openNode(node.id)}>{t('event.editActions')}</Button>
          </div>
        );
      }
      const stacks: WStack[] = [{ id: 'actions', hat: null, body: d.actions, enabled: true }];
      return (
        <BlockWorkspace
          stacks={stacks}
          mode="story"
          ctx={{ project, scene: null, t, engine: session.engine, nodeId: node.id, storyLevel: true }}
          selectedStack="actions"
          onChange={(recipe, label) => session.update(label, (draft) => {
            const n = draft.nodes[node.id];
            const s: WStack[] = [{ id: 'actions', hat: null, body: (n.data as EventData).actions, enabled: true }];
            recipe(s);
            (n.data as EventData).actions = s[0].body;
          })}
          header={<div className="blk-header muted small"><Icon name="info" size={13} /> {t('event.semantics')}</div>}
        />
      );
    }
    case 'core.start':
      return <div className="node-form muted small">{t('node.start.desc')}</div>;
    case 'core.scene': {
      const d = node.data as SceneData;
      return <Field label={t('scene.number')}><TextInput value={d.number} onChange={(v) => upd(t('scene.edit'), (x) => { x.number = v; })} /></Field>;
    }
  }
  // Module-defined node types: generated form from the type's property schema.
  const def = session.engine.nodeTypes.get(node.type);
  if (def?.props?.length) {
    return (
      <div className="node-form">
        <PropEditor defs={def.props} values={node.data || {}} onChange={(k, v, tr) => upd(t('node.edit'), (x) => { x[k] = v; }, tr ? `prop-${k}` : undefined)}
          ctx={{ project, t, assetUrl: (id) => { const a = project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; }, values: node.data || {} }} />
      </div>
    );
  }
  if (!def) return <div className="issue error"><Icon name="error" size={14} />{t('node.missingType', { type: node.type })}</div>;
  return null;
}
