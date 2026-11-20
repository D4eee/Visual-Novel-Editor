import type { Choice, SceneData, VarOp } from '@vne/core';
import { createChoice, syncSceneChoiceEdges } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { IconButton, TextInput, Select, Toggle, Button, cx } from '../ui/controls';
import { ExprInput } from '../script/ExprInput';
import { Icon } from '../ui/Icon';
import { openMenu } from '../ui/Menu';
import { useState } from 'react';

/** Edit a scene's choices; keeps story-graph connections in sync (stable choice ids). */
export function updateChoices(session: ProjectSession, nodeId: string, label: string, fn: (choices: Choice[]) => void, mergeKey?: string): void {
  session.update(label, (d) => {
    const node = d.nodes[nodeId];
    if (!node) return;
    const data = node.data as SceneData;
    const before: Choice[] = JSON.parse(JSON.stringify(data.choices));
    fn(data.choices);
    syncSceneChoiceEdges(d, nodeId, before);
  }, mergeKey ? { mergeKey } : undefined);
}

export function ChoicesEditor({ session, nodeId, compact }: { session: ProjectSession; nodeId: string; compact?: boolean }) {
  const t = session.i18n.t;
  const node = session.project.nodes[nodeId];
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  if (!node || node.type !== 'core.scene') return null;
  const data = node.data as SceneData;
  const scene = data;
  const exprCtx = { project: session.project, scene, t };
  const vars = [...session.project.variables, ...scene.localVariables];
  const connected = (c: Choice) => session.project.edges.some((e) => e.from.node === nodeId && e.from.port === `c:${c.id}`);

  const add = () => {
    const c = createChoice(t('choice.new', { n: data.choices.length + 1 }));
    updateChoices(session, nodeId, t('choice.add'), (list) => { list.push(c); });
    setOpen(c.id);
  };

  return (
    <div className={cx('choices', compact && 'compact')}>
      {data.choices.map((c, i) => (
        <div key={c.id} className={cx('choice-row', open === c.id && 'open', dragging === c.id && 'dragging')}
          onDragOver={(e) => { if (dragging) e.preventDefault(); }}
          onDrop={() => {
            if (!dragging || dragging === c.id) return;
            updateChoices(session, nodeId, t('choice.reorder'), (list) => { const from = list.findIndex((x) => x.id === dragging); const [m] = list.splice(from, 1); list.splice(i, 0, m); });
            setDragging(null);
          }}>
          <div className="choice-main">
            <span className="drag-handle" draggable onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)} title={t('common.dragToReorder')}><Icon name="grip" size={14} /></span>
            <span className={cx('port-dot', connected(c) && 'connected')} title={connected(c) ? t('choice.connected') : t('choice.notConnected')} />
            <TextInput value={c.text} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { const x = list.find((y) => y.id === c.id); if (x) x.text = v; })} placeholder={t('choice.textPlaceholder')} ariaLabel={t('choice.text')} />
            {(c.condition || c.effects.length > 0 || c.hidden) && <span className="choice-flags">{c.condition && <Icon name="branch" size={12} />}{c.effects.length > 0 && <Icon name="variable" size={12} />}{c.hidden && <Icon name="eyeOff" size={12} />}</span>}
            <IconButton icon={open === c.id ? 'chevronUp' : 'sliders'} size={14} title={t('choice.options')} onClick={() => setOpen(open === c.id ? null : c.id)} active={open === c.id} />
            <IconButton icon="trash" size={14} title={t('common.delete')} onClick={() => updateChoices(session, nodeId, t('choice.delete'), (list) => { const k = list.findIndex((x) => x.id === c.id); if (k >= 0) list.splice(k, 1); })} />
          </div>
          {open === c.id && (
            <div className="choice-details">
              <div className="row-label">{t('choice.condition')}</div>
              <ExprInput value={c.condition} ctx={exprCtx} placeholder={t('choice.alwaysAvailable')} onChange={(e) => updateChoices(session, nodeId, t('choice.edit'), (list) => { const x = list.find((y) => y.id === c.id); if (x) x.condition = e; })} />
              {c.condition && (
                <div className="row-inline">
                  <span className="muted small">{t('choice.whenUnavailable')}</span>
                  <Select value={c.unavailable} options={[{ value: 'hide', label: t('choice.hide') }, { value: 'disable', label: t('choice.disable') }]} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { const x = list.find((y) => y.id === c.id); if (x) x.unavailable = v as any; })} />
                </div>
              )}
              <div className="row-label">{t('choice.effects')}</div>
              {c.effects.map((op, k) => (
                <div className="var-op" key={k}>
                  <Select value={op.varId} options={vars.map((v) => ({ value: v.id, label: v.name }))} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { list.find((y) => y.id === c.id)!.effects[k].varId = v; })} placeholder={t('vars.choose')} />
                  <Select value={op.op} options={[{ value: 'set', label: '=' }, { value: 'add', label: '+=' }, { value: 'sub', label: '−=' }, { value: 'toggle', label: t('varop.toggle') }]} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { list.find((y) => y.id === c.id)!.effects[k].op = v as VarOp['op']; })} />
                  {op.op !== 'toggle' && <TextInput value={String(op.value)} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { const def = vars.find((x) => x.id === op.varId); list.find((y) => y.id === c.id)!.effects[k].value = def?.type === 'number' ? Number(v) || 0 : def?.type === 'boolean' ? v === 'true' : v; })} className="narrow" />}
                  <IconButton icon="close" size={13} title={t('common.remove')} onClick={() => updateChoices(session, nodeId, t('choice.edit'), (list) => { list.find((y) => y.id === c.id)!.effects.splice(k, 1); })} />
                </div>
              ))}
              <Button small icon="plus" kind="ghost" disabled={!vars.length} title={!vars.length ? t('vars.noneYet') : undefined}
                onClick={() => updateChoices(session, nodeId, t('choice.edit'), (list) => { list.find((y) => y.id === c.id)!.effects.push({ varId: vars[0].id, op: vars[0].type === 'number' ? 'add' : 'set', value: vars[0].type === 'number' ? 1 : vars[0].type === 'boolean' ? true : '' }); })}>
                {t('choice.addEffect')}
              </Button>
              <div className="row-inline">
                <Toggle value={c.hidden} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { list.find((y) => y.id === c.id)!.hidden = v; })} label={t('choice.startHidden')} title={t('choice.startHiddenHint')} />
              </div>
              {scene.animations.length > 0 && (
                <div className="row-inline">
                  <span className="muted small">{t('choice.playAnimation')}</span>
                  <Select value={c.animationId || ''} options={[{ value: '', label: t('common.none') }, ...scene.animations.map((a) => ({ value: a.id, label: a.name }))]} onChange={(v) => updateChoices(session, nodeId, t('choice.edit'), (list) => { list.find((y) => y.id === c.id)!.animationId = v || null; })} />
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="choices-foot">
        <Button small icon="plus" onClick={add}>{t('choice.add')}</Button>
        {data.choices.length === 0 && <span className="muted small">{t('choice.noneHint')}</span>}
        {data.choices.length > 0 && <IconButton icon="more" size={14} title={t('common.more')} onClick={(e) => openMenu(e, [{ label: t('choice.removeAll'), icon: 'trash', danger: true, onClick: () => updateChoices(session, nodeId, t('choice.removeAll'), (list) => { list.splice(0, list.length); }) }])} />}
      </div>
    </div>
  );
}
