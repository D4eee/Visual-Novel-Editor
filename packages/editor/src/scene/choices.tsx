import type { Layer, SceneData, VarOp } from '@vne/core';
import { choiceLayers, CHOICE_LAYER } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { IconButton, TextInput, Select, Button } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { addLayer, updateScene } from './sceneOps';

/** Add a choice element to a scene (it becomes a new output of the scene node). */
export function addChoice(session: ProjectSession, nodeId: string): string | null {
  return addLayer(session, nodeId, CHOICE_LAYER);
}

/** Variable changes made when a choice is picked (inspector section of a choice element). */
export function ChoiceEffects({ session, nodeId, layer }: { session: ProjectSession; nodeId: string; layer: Layer }) {
  const t = session.i18n.t;
  const scene = session.project.nodes[nodeId]?.data as SceneData;
  const vars = [...session.project.variables, ...(scene?.localVariables || [])];
  const effects: VarOp[] = Array.isArray(layer.props.effects) ? layer.props.effects : [];
  const edit = (fn: (list: VarOp[]) => void) => updateScene(session, nodeId, t('choice.edit'), (s) => {
    const l = s.layers.find((x) => x.id === layer.id);
    if (!l) return;
    const list: VarOp[] = Array.isArray(l.props.effects) ? l.props.effects : (l.props.effects = []);
    fn(list);
  });
  return (
    <div className="choice-effects">
      {effects.map((op, k) => (
        <div className="var-op" key={k}>
          <Select value={op.varId} options={vars.map((v) => ({ value: v.id, label: v.name }))} onChange={(v) => edit((list) => { list[k].varId = v; })} placeholder={t('vars.choose')} />
          <Select value={op.op} options={[{ value: 'set', label: '=' }, { value: 'add', label: '+=' }, { value: 'sub', label: '−=' }, { value: 'toggle', label: t('varop.toggle') }]} onChange={(v) => edit((list) => { list[k].op = v as VarOp['op']; })} />
          {op.op !== 'toggle' && <TextInput value={String(op.value)} className="narrow" onChange={(v) => edit((list) => { const def = vars.find((x) => x.id === op.varId); list[k].value = def?.type === 'number' ? Number(v) || 0 : def?.type === 'boolean' ? v === 'true' : v; })} />}
          <IconButton icon="close" size={13} title={t('common.remove')} onClick={() => edit((list) => { list.splice(k, 1); })} />
        </div>
      ))}
      <Button small icon="plus" kind="ghost" disabled={!vars.length} title={!vars.length ? t('vars.noneYet') : t('choice.effectsHint')}
        onClick={() => edit((list) => { list.push({ varId: vars[0].id, op: vars[0].type === 'number' ? 'add' : 'set', value: vars[0].type === 'number' ? 1 : vars[0].type === 'boolean' ? true : '' }); })}>
        {t('choice.addEffect')}
      </Button>
    </div>
  );
}

/** Compact list of a scene's choices for the story-graph inspector. */
export function ChoicesSummary({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  const t = session.i18n.t;
  const node = session.project.nodes[nodeId];
  if (!node || node.type !== 'core.scene') return null;
  const list = choiceLayers(node.data as SceneData);
  const connected = (id: string) => session.project.edges.some((e) => e.from.node === nodeId && e.from.port === `c:${id}`);
  const open = (layerId: string) => { session.openNode(nodeId); session.setSceneUI(nodeId, { selectedLayers: [layerId], subTab: 'composition' }); };
  return (
    <div className="choices compact">
      {list.map((l) => (
        <button key={l.id} type="button" className="link-row" onClick={() => open(l.id)} title={connected(l.id) ? t('choice.connected') : t('choice.notConnected')}>
          <span className={connected(l.id) ? 'port-dot connected' : 'port-dot'} />
          <span>{String(l.props.text || l.name)}</span>
          {l.props.condition && <Icon name="branch" size={12} />}
          {l.props.hidden && <Icon name="eyeOff" size={12} />}
        </button>
      ))}
      <Button small icon="plus" kind="ghost" onClick={() => { const id = addChoice(session, nodeId); if (id) open(id); }}>{t('choice.add')}</Button>
    </div>
  );
}
