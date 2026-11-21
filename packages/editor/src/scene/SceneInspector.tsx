import type { Layer, SceneData } from '@vne/core';
import { newId, sceneLines, choiceLayers, DIALOGUE_LAYER, CHOICE_LAYER } from '@vne/core';
import { DialogueLines } from './DialoguePanel';
import { ChoiceEffects } from './choices';
import { animatedProps } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { sceneOf, setLayerProps, updateScene, setParent, toggleKey, keyStateFor } from './sceneOps';
import { PropEditor, PropContext } from '../inspect/PropEditor';
import { Field, TextInput, ColorInput, Select, NumberInput, Toggle, Section, Button, IconButton, Tabs } from '../ui/controls';
import { EffectsTab, PresetsTab, InspectorTab } from './ElementTabs';
import { Icon } from '../ui/Icon';
import { useEffect, useRef } from 'react';
import { makeMountContext, safeMount } from '../modules/editorApi';
import { GLOBAL_NODE_ID } from '@vne/core';
import { ParamsEditor, SpriteFramesEditor } from '../script/GameEditors';
import { pageElements, pageName, revealElement, openGlobalPage, moveElements } from './pageContext';

export function SceneInspector({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const scene = sceneOf(session, nodeId);
  if (!scene) return null;
  const ui = session.sceneUI(nodeId);
  const layers = ui.selectedLayers.map((id) => scene.layers.find((l) => l.id === id)).filter(Boolean) as Layer[];
  if (layers.length === 1) return <LayerInspector session={session} nodeId={nodeId} scene={scene} layer={layers[0]} />;
  if (!layers.length && ui.selectedLayers.length === 1) {
    // An element this page shows but does not own: inherited or global.
    const ctxEl = pageElements(session, nodeId).find((e) => e.layer.id === ui.selectedLayers[0] && e.origin !== 'own');
    if (ctxEl) {
      const def = session.engine.layerTypes.get(ctxEl.layer.type);
      return (
        <div className="inspector-body">
          <div className="insp-title"><span className="type-chip"><Icon name={def?.icon || 'layers'} size={14} />{def ? t(def.label) : ctxEl.layer.type}</span></div>
          <div className="insp-context">
            <div className="insp-context-name"><Icon name={ctxEl.origin === 'global' ? 'globe' : 'inherit'} size={15} />{ctxEl.layer.name}</div>
            <p className="muted small">{ctxEl.origin === 'global' ? t('global.inspectorText') : t(ctxEl.paused ? 'inherit.inspectorPaused' : 'inherit.inspectorText', { page: pageName(session, ctxEl.from) })}</p>
            {ctxEl.origin === 'global'
              ? <><Button icon="arrowRight" onClick={() => openGlobalPage(session, ctxEl.layer.id)}>{t('global.editOn')}</Button> <Button icon="arrowDown" onClick={() => moveElements(session, GLOBAL_NODE_ID, nodeId, [ctxEl.layer.id])}>{t('global.moveHere')}</Button></>
              : <Button icon="arrowRight" onClick={() => revealElement(session, ctxEl.from!, ctxEl.layer.id)}>{t('inherit.open', { page: pageName(session, ctxEl.from) })}</Button>}
            <p className="muted small">{t('inherit.scriptsTip')}</p>
          </div>
        </div>
      );
    }
  }
  if (layers.length > 1) {
    return (
      <div className="inspector-body">
        <div className="insp-title"><Icon name="layers" size={16} /> {t('inspector.nLayers', { n: layers.length })}</div>
      </div>
    );
  }
  if (nodeId === GLOBAL_NODE_ID) {
    return (
      <div className="inspector-body">
        <div className="insp-title"><Icon name="globe" size={16} /> {t('global.title')}</div>
        <div className="insp-context">
          <p className="muted small">{t('global.note')}</p>
          <p className="muted small">{t('global.inspectorHelp')}</p>
        </div>
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
  const tab: InspectorTab = ui.inspectorTab || 'options';
  const visual = def?.visual !== false;
  return (
    <div className="inspector-body">
      <div className="insp-title">
        <span className="type-chip" title={def?.visual ? t('inspector.keyTip') : undefined}><Icon name={def?.icon || 'layers'} size={14} />{def ? t(def.label) : layer.type}</span>
        {ui.record && <span className="rec-chip"><Icon name="record" size={12} />{t('timeline.recording')}</span>}
      </div>
      <Tabs<InspectorTab> className="insp-tabs" value={tab} onChange={(v) => session.setSceneUI(nodeId, { inspectorTab: v })} tabs={[
        { id: 'options', label: t('insp.tab.options'), icon: 'sliders' },
        { id: 'effects', label: t('insp.tab.effects'), icon: 'sparkles', badge: layer.effect ? '●' : null },
        { id: 'presets', label: t('insp.tab.presets'), icon: 'bookmark' },
      ]} />
      {tab === 'effects' ? <EffectsTab session={session} nodeId={nodeId} scene={scene} layer={layer} />
        : tab === 'presets' ? <PresetsTab session={session} nodeId={nodeId} scene={scene} layer={layer} />
          : <>
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
      {layer.type === 'core.sprite' && (
        <Section id="insp.sprite.frames" title={t('sprite.frames')} tip={t('sprite.framesHint')}>
          <SpriteFramesEditor session={session} nodeId={nodeId} layer={layer} settings={false} />
        </Section>
      )}
      {nodeId === GLOBAL_NODE_ID && visual && (
        <Field label={t('global.zone')}>
          <Select value={layer.zone || 'front'} options={[{ value: 'front', label: t('global.zone.front') }, { value: 'back', label: t('global.zone.back') }]} onChange={(v) => updateScene(session, nodeId, t('global.behind'), (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) l.zone = v as any; })} />
        </Field>
      )}
      {visual && <ParentField session={session} nodeId={nodeId} scene={scene} layer={layer} />}
      <Section id="insp.params" title={<>{t('params.title')}{layer.params?.length ? <span className="muted"> {layer.params.length}</span> : null}</>} tip={t('params.hint')} defaultOpen={!!layer.params?.length}>
        <ParamsEditor session={session} nodeId={nodeId} layer={layer} />
      </Section>
      {layer.type === CHOICE_LAYER && (
        <Section id="insp.choice.effects" title={t('choice.effects')} tip={t('choice.effectsHint')}>
          <ChoiceEffects session={session} nodeId={nodeId} layer={layer} />
        </Section>
      )}
      {custom.map((c) => <ModuleInspector key={c.id} session={session} nodeId={nodeId} layer={layer} def={c} />)}
          </>}
    </div>
  );
}

/** Parent element (After Effects-style "parent & link"): the element moves, turns and scales with it. */
function ParentField({ session, nodeId, scene, layer }: { session: ProjectSession; nodeId: string; scene: SceneData; layer: Layer }) {
  const t = useT();
  // An element cannot be parented to itself or to one of its own children.
  const follows = (id: string, of: string): boolean => { let p = scene.layers.find((l) => l.id === id)?.link; for (let i = 0; p && i < 64; i++) { if (p === of) return true; p = scene.layers.find((l) => l.id === p)?.link; } return false; };
  const options = scene.layers.filter((l) => l.id !== layer.id && (l.parentId || null) === (layer.parentId || null) && session.engine.layerTypes.get(l.type)?.visual !== false && !follows(l.id, layer.id));
  return (
    <Field label={<><Icon name="parent" size={12} /> {t('insp.parent')}</>} hint={t('insp.parentHint')}>
      <Select value={layer.link || ''} options={[{ value: '', label: t('insp.noParent') }, ...options.map((l) => ({ value: l.id, label: l.name }))]}
        onChange={(v) => setParent(session, nodeId, layer.id, v || null)} />
    </Field>
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
