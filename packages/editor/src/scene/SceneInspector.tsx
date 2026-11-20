import type { Layer, SceneData } from '@vne/core';
import { newId, sceneLines, choiceLayers, DIALOGUE_LAYER, CHOICE_LAYER } from '@vne/core';
import { DialogueLines } from './DialoguePanel';
import { ChoiceEffects } from './choices';
import { animatedProps } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { sceneOf, setLayerProps, toggleKey, keyStateFor, updateScene } from './sceneOps';
import { PropEditor, PropContext } from '../inspect/PropEditor';
import { Field, TextInput, ColorInput, Select, NumberInput, Toggle, Section, Button, IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useEffect, useRef } from 'react';
import { makeMountContext, safeMount } from '../modules/editorApi';

export function SceneInspector({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const scene = sceneOf(session, nodeId);
  if (!scene) return null;
  const ui = session.sceneUI(nodeId);
  const layers = ui.selectedLayers.map((id) => scene.layers.find((l) => l.id === id)).filter(Boolean) as Layer[];
  if (layers.length === 1) return <LayerInspector session={session} nodeId={nodeId} scene={scene} layer={layers[0]} />;
  if (layers.length > 1) {
    return (
      <div className="inspector-body">
        <div className="insp-title"><Icon name="layers" size={16} /> {t('inspector.nLayers', { n: layers.length })}</div>
      </div>
    );
  }
  return <SceneProps session={session} nodeId={nodeId} scene={scene} />;
}

function LayerInspector({ session, nodeId, scene, layer }: { session: ProjectSession; nodeId: string; scene: SceneData; layer: Layer }) {
  const t = useT();
  const ui = session.sceneUI(nodeId);
  const def = session.engine.layerTypes.get(layer.type);
  const defs = session.engine.layerProps(layer.type);
  const values = animatedProps(session.engine, scene, layer, ui.clipId, ui.time);
  const custom = session.ext.inspectors.filter((i) => i.target === layer.type);
  const ctx: PropContext = {
    project: session.project, scene, t,
    assetUrl: (id) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; },
    values,
    keyState: (k) => keyStateFor(session, scene, layer.id, k),
    onToggleKey: (k) => toggleKey(session, nodeId, layer.id, k),
    layerId: layer.id,
  };
  const fxParams = layer.effect?.kind === 'inline' ? layer.effect.graph.params : layer.effect?.kind === 'ref' ? session.project.effectGraphs.find((g) => g.id === (layer.effect as any).graphId)?.params || [] : [];
  return (
    <div className="inspector-body">
      <div className="insp-title">
        <span className="type-chip" title={def?.visual ? t('inspector.keyTip') : undefined}><Icon name={def?.icon || 'layers'} size={14} />{def ? t(def.label) : layer.type}</span>
        {ui.record && <span className="rec-chip"><Icon name="record" size={12} />{t('timeline.recording')}</span>}
      </div>
      <Field label={t('common.name')}><TextInput value={layer.name} onChange={(v) => updateScene(session, nodeId, t('common.rename'), (s) => { s.layers.find((l) => l.id === layer.id)!.name = v; })} /></Field>
      {!def && <div className="issue error"><Icon name="error" size={14} />{t('layer.missingType', { type: layer.type })}</div>}
      {layer.type === DIALOGUE_LAYER && <DialogueLines session={session} nodeId={nodeId} layerId={layer.id} />}
      <PropEditor defs={defs} values={values} idPrefix={`layer.${layer.type}`} ctx={ctx}
        onChange={(k, v, tr) => {
          const patch: Record<string, any> = { [k]: v };
          if (k === 'characterId') patch.portraitId = null;
          setLayerProps(session, nodeId, layer.id, patch, tr ? { mergeKey: `p-${layer.id}-${k}` } : {});
          // A choice keeps its layer name in step with its text until renamed by hand.
          if (layer.type === CHOICE_LAYER && k === 'text' && layer.name === String(layer.props.text ?? '')) {
            updateScene(session, nodeId, t('choice.edit'), (sd) => { const l = sd.layers.find((x) => x.id === layer.id); if (l) l.name = String(v).slice(0, 40) || l.name; }, `p-${layer.id}-name`);
          }
        }} />
      {layer.type === CHOICE_LAYER && (
        <Section id="insp.choice.effects" title={t('choice.effects')} tip={t('choice.effectsHint')}>
          <ChoiceEffects session={session} nodeId={nodeId} layer={layer} />
        </Section>
      )}
      {fxParams.length > 0 && (
        <Section id="insp.fxparams" title={t('effects.params')}>
          {fxParams.map((p) => (
            <Field key={p.id} label={<>{p.name}<IconButton icon="keyframe" size={12} className={`key-toggle ${keyStateFor(session, scene, layer.id, `fx.${p.id}`)}`} title={t('timeline.addKey')} onClick={() => toggleKey(session, nodeId, layer.id, `fx.${p.id}`)} /></>}>
              {p.type === 'number' ? <NumberInput value={Number(values[`fx.${p.id}`] ?? p.default)} min={p.min} max={p.max} step={0.01} onChange={(v, tr) => setLayerProps(session, nodeId, layer.id, { [`fx.${p.id}`]: v }, tr ? { mergeKey: `fx-${p.id}` } : {})} />
                : p.type === 'color' ? <ColorInput value={String(values[`fx.${p.id}`] ?? p.default)} onChange={(v, tr) => setLayerProps(session, nodeId, layer.id, { [`fx.${p.id}`]: v }, tr ? { mergeKey: `fx-${p.id}` } : {})} />
                  : <Toggle value={!!(values[`fx.${p.id}`] ?? p.default)} onChange={(v) => setLayerProps(session, nodeId, layer.id, { [`fx.${p.id}`]: v })} />}
            </Field>
          ))}
        </Section>
      )}
      {def?.visual !== false && <Section id="insp.layer.blend" title={t('group.compositing')} defaultOpen={false}>
        <Field label={t('prop.blend')}>
          <Select value={layer.blend || 'normal'} options={['normal', 'multiply', 'screen', 'overlay', 'lighter', 'darken', 'lighten', 'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference'].map((b) => ({ value: b, label: t(`blend.${b === 'normal' ? 'source-over' : b}`) }))}
            onChange={(v) => updateScene(session, nodeId, t('layer.edit'), (s) => { s.layers.find((l) => l.id === layer.id)!.blend = v === 'normal' ? undefined : v; })} />
        </Field>
        <Field label={t('effects.title')}>
          <Button small icon="sparkles" onClick={() => session.setSceneUI(nodeId, { selectedLayers: [layer.id], effectsOpen: true })}>{layer.effect ? t('effects.edit') : t('effects.add')}</Button>
        </Field>
      </Section>}
      {custom.map((c) => <ModuleInspector key={c.id} session={session} nodeId={nodeId} layer={layer} def={c} />)}
    </div>
  );
}

function ModuleInspector({ session, nodeId, layer, def }: { session: ProjectSession; nodeId: string; layer: Layer; def: { id: string; moduleId: string; title?: string; mount: any } }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (!ref.current) return;
    return safeMount(ref.current, def.mount, makeMountContext(session, def.moduleId, {
      nodeId, layerId: layer.id, data: layer.props,
      setLayerProps: (patch, label) => setLayerProps(session, nodeId, layer.id, patch, { label }),
    }), (err) => session.moduleError(def.moduleId, err, 'inspector'));
  }, [def.id, layer.id, session.version]);
  return <Section id={`insp.mod.${def.id}`} title={<><Icon name="module" size={13} /> {def.title ? t(def.title) : def.moduleId}</>}><div ref={ref} className="module-mount" /></Section>;
}

function SceneProps({ session, nodeId, scene }: { session: ProjectSession; nodeId: string; scene: SceneData }) {
  const t = useT();
  const node = session.project.nodes[nodeId];
  const upd = (label: string, fn: (s: SceneData) => void, mk?: string) => updateScene(session, nodeId, label, fn, mk);
  const tr = scene.transition;
  const trDef = session.engine.transitions.get(tr?.type || '');
  return (
    <div className="inspector-body">
      <div className="insp-title"><Icon name="scene" size={16} /> {t('scene.properties')}</div>
      <Field label={t('common.name')}><TextInput value={node.name} onChange={(v) => session.update(t('common.rename'), (d) => { d.nodes[nodeId].name = v; })} /></Field>
      <Field label={t('scene.number')}><TextInput value={scene.number} onChange={(v) => upd(t('scene.edit'), (s) => { s.number = v; })} /></Field>
      <Field label={t('scene.background')}><ColorInput value={scene.background} onChange={(v, trn) => upd(t('scene.edit'), (s) => { s.background = v; }, trn ? 'bg' : undefined)} /></Field>
      <Section id="scene.transition" title={t('scene.transitionIn')}>
        <Field label={t('scene.transition')}>
          <Select value={tr?.type || ''} options={[{ value: '', label: t('scene.transitionDefault') }, ...session.engine.transitions.list().map((x) => ({ value: x.id, label: t(x.label) }))]}
            onChange={(v) => upd(t('scene.edit'), (s) => { s.transition = v ? { type: v, duration: s.transition?.duration ?? 0.6, params: {} } : null; })} />
        </Field>
        {tr && (
          <>
            <Field label={t('scene.duration')}><NumberInput value={tr.duration} min={0} step={0.1} unit="s" onChange={(v) => upd(t('scene.edit'), (s) => { s.transition!.duration = v; }, 'trdur')} /></Field>
            {trDef?.params?.map((p) => (
              <Field key={p.key} label={t(p.label)}>
                {p.type === 'color' ? <ColorInput value={String(tr.params?.[p.key] ?? p.default)} onChange={(v) => upd(t('scene.edit'), (s) => { s.transition!.params = { ...(s.transition!.params || {}), [p.key]: v }; })} />
                  : p.type === 'select' ? <Select value={String(tr.params?.[p.key] ?? p.default)} options={(p.options || []).map((o) => ({ value: String(o.value), label: t(o.label) }))} onChange={(v) => upd(t('scene.edit'), (s) => { s.transition!.params = { ...(s.transition!.params || {}), [p.key]: v }; })} />
                    : <NumberInput value={Number(tr.params?.[p.key] ?? p.default)} min={p.min} max={p.max} step={0.05} onChange={(v) => upd(t('scene.edit'), (s) => { s.transition!.params = { ...(s.transition!.params || {}), [p.key]: v }; })} />}
              </Field>
            ))}
          </>
        )}
      </Section>
      <Section id="scene.flow" title={t('scene.progression')} tip={t('scene.progressTip')}>
        <Toggle value={scene.hideTextbox} onChange={(v) => upd(t('scene.edit'), (s) => { s.hideTextbox = v; })} label={t('scene.hideTextbox')} />
        {!sceneLines(scene).length && !choiceLayers(scene).length && (
          <Field label={t('scene.hold')} hint={t('scene.holdHint')}><NumberInput value={scene.holdSeconds} min={0} step={0.5} unit="s" onChange={(v) => upd(t('scene.edit'), (s) => { s.holdSeconds = v; }, 'hold')} /></Field>
        )}
      </Section>
      <Section id="scene.vars" title={t('vars.sceneTitle')} tip={t('vars.sceneEmpty')} actions={<IconButton icon="plus" size={14} title={t('vars.add')} onClick={() => upd(t('vars.add'), (s) => { s.localVariables.push({ id: newId('var'), name: `local${s.localVariables.length + 1}`, type: 'number', initial: 0, scope: 'game' }); })} />}>
        {scene.localVariables.map((v, i) => (
          <div key={v.id} className="var-row">
            <TextInput value={v.name} onChange={(x) => upd(t('vars.edit'), (s) => { s.localVariables[i].name = x; })} ariaLabel={t('common.name')} />
            <Select value={v.type} options={[{ value: 'number', label: t('vars.number') }, { value: 'boolean', label: t('vars.boolean') }, { value: 'string', label: t('vars.string') }]} onChange={(x) => upd(t('vars.edit'), (s) => { s.localVariables[i].type = x as any; s.localVariables[i].initial = x === 'number' ? 0 : x === 'boolean' ? false : ''; })} />
            <TextInput value={String(v.initial)} className="narrow" onChange={(x) => upd(t('vars.edit'), (s) => { s.localVariables[i].initial = v.type === 'number' ? Number(x) || 0 : v.type === 'boolean' ? x === 'true' : x; })} ariaLabel={t('vars.initial')} />
            <IconButton icon="close" size={13} title={t('common.remove')} onClick={() => upd(t('vars.delete'), (s) => { s.localVariables.splice(i, 1); })} />
          </div>
        ))}
      </Section>
    </div>
  );
}
