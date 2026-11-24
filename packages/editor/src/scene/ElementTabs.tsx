/**
 * The Effects and Presets tabs of the element inspector (the Options tab is the property list).
 *
 * Effects: the element's picture effect (edit / save / remove, its keyframable parameters),
 * effect presets to apply, and how the element blends with what is behind it.
 * Presets: ready-made animations (entrance, emphasis, exit) written as keyframes at the
 * playhead, built-in looks for the element type, and the user's own saved looks.
 */
import { useEffect, useState } from 'react';
import type { Layer, SceneData, EffectPreset } from '@vne/core';
import { newId, effectGraphOf } from '@vne/core';
import { animatedProps, normalizeTrack } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { store, useT } from '../state/store';
import { call } from '../host';
import { ensureClip, keyStateFor, setLayerProps, toggleKey, updateScene } from './sceneOps';
import { EFFECT_PRESETS } from '../effects/presets';
import { applyEffectPreset, saveEffectAsPreset, useEffectPresets, openPresetManager } from '../effects/userPresets';
import { Button, ColorInput, Empty, Field, IconButton, NumberInput, Section, Select, Toggle, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { CharacterPresetsSection, ScenePresetsSection } from '../library/LibraryPanels';

export type InspectorTab = 'options' | 'effects' | 'presets';

/* ------------------------------------------------------------------ */
/* Effects tab                                                          */
/* ------------------------------------------------------------------ */

export function EffectsTab({ session, nodeId, scene, layer }: { session: ProjectSession; nodeId: string; scene: SceneData; layer: Layer }) {
  const t = useT();
  const ui = session.sceneUI(nodeId);
  const def = session.engine.layerTypes.get(layer.type);
  const mine = useEffectPresets();
  if (def?.visual === false) return <Empty icon="sparkles" title={t('insp.noEffects')}>{t('insp.noEffectsText')}</Empty>;
  const values = animatedProps(session.engine, scene, layer, ui.clipId, ui.time);
  const graph = layer.effect ? effectGraphOf(session.project, layer.effect) : null;
  const params = graph?.params || [];
  const applyBuiltIn = (make: () => any, label: string) => updateScene(session, nodeId, t('fxp.applyNamed', { name: label }), (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) l.effect = { kind: 'inline', graph: make() }; });
  const edit = () => session.setSceneUI(nodeId, { selectedLayers: [layer.id], effectsOpen: true });
  return (
    <>
      <Section id="insp.fx.current" title={t('insp.currentEffect')}>
        {graph ? (
          <div className="fx-current">
            <div className="fx-current-name"><Icon name="sparkles" size={15} /><span>{graph.name}</span>{layer.effect?.kind === 'ref' && <span className="muted small">{t('insp.sharedEffect')}</span>}</div>
            <div className="fx-current-actions">
              <Button small icon="wand" onClick={edit}>{t('insp.editGraph')}</Button>
              <IconButton icon="bookmarkPlus" size={14} title={t('fxp.saveCurrent')} onClick={() => saveEffectAsPreset(session, layer)} />
              <IconButton icon="trash" size={14} title={t('insp.removeEffect')} onClick={() => updateScene(session, nodeId, t('insp.removeEffect'), (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) delete l.effect; })} />
            </div>
          </div>
        ) : <p className="muted small">{t('insp.noEffectYet')}</p>}
        {params.map((p) => (
          <Field key={p.id} label={<>{p.name}<IconButton icon="keyframe" size={12} className={`key-toggle ${keyStateFor(session, scene, layer.id, `fx.${p.id}`)}`} title={t('timeline.addKey')} onClick={() => toggleKey(session, nodeId, layer.id, `fx.${p.id}`)} /></>}>
            {p.type === 'number' ? <NumberInput value={Number(values[`fx.${p.id}`] ?? p.default)} min={p.min} max={p.max} step={0.01} onChange={(v, tr) => setLayerProps(session, nodeId, layer.id, { [`fx.${p.id}`]: v }, tr ? { mergeKey: `fx-${p.id}` } : {})} />
              : p.type === 'color' ? <ColorInput value={String(values[`fx.${p.id}`] ?? p.default)} onChange={(v, tr) => setLayerProps(session, nodeId, layer.id, { [`fx.${p.id}`]: v }, tr ? { mergeKey: `fx-${p.id}` } : {})} />
                : <Toggle value={!!(values[`fx.${p.id}`] ?? p.default)} onChange={(v) => setLayerProps(session, nodeId, layer.id, { [`fx.${p.id}`]: v })} />}
          </Field>
        ))}
      </Section>
      <Section id="insp.fx.builtin" title={t('fxp.builtIn')} tip={t('insp.effectPresetsTip')}>
        <div className="preset-grid">
          {EFFECT_PRESETS.map((p) => (
            <button key={p.id} type="button" className="preset-card" onClick={() => { applyBuiltIn(p.make, t(p.label)); if (p.id === 'empty') edit(); }}>
              <span className={cx('preset-swatch fx', `fx-${p.id}`)}><Icon name={p.id === 'empty' ? 'plus' : 'sparkles'} size={14} /></span>
              <span className="preset-name">{t(p.label)}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section id="insp.fx.mine" title={t('fxp.mine')} actions={<IconButton icon="library" size={14} title={t('fxp.manage')} onClick={() => openPresetManager(nodeId, [layer.id])} />}>
        {mine === null ? <p className="muted small">{t('common.loading')}</p>
          : !mine.length ? <p className="muted small">{t('insp.noMyEffects')}</p>
            : <div className="preset-list">{mine.map((p: EffectPreset) => (
              <button key={p.id} type="button" className="preset-row" onClick={() => applyEffectPreset(session, nodeId, [layer.id], p)} title={p.description || t('insp.apply')}>
                <Icon name="bookmark" size={13} /><span className="preset-name">{p.name}</span><span className="preset-apply">{t('insp.apply')}</span>
              </button>
            ))}</div>}
      </Section>
      <Section id="insp.layer.blend" title={t('insp.blending')}>
        <Field label={t('prop.blend')}>
          <Select value={layer.blend || 'normal'} options={['normal', 'multiply', 'screen', 'overlay', 'lighter', 'darken', 'lighten', 'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference'].map((b) => ({ value: b, label: t(`blend.${b === 'normal' ? 'source-over' : b}`) }))}
            onChange={(v) => updateScene(session, nodeId, t('layer.edit'), (s) => { s.layers.find((l) => l.id === layer.id)!.blend = v === 'normal' ? undefined : v; })} />
        </Field>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Animation presets                                                    */
/* ------------------------------------------------------------------ */

type Base = Record<string, number>;
/** Keyframes of one property: [position 0–1 within the preset, value from the element's current values, ease to the next key]. */
type KeySpec = [number, (b: Base) => number, string?];
export interface AnimPreset { id: string; group: 'in' | 'emphasis' | 'out'; icon: string; tracks: Record<string, KeySpec[]> }

const at = (k: string, f = (v: number) => v) => (b: Base) => f(b[k]);
const SLIDE = 360;

export const ANIM_PRESETS: AnimPreset[] = [
  { id: 'fadeIn', group: 'in', icon: 'eye', tracks: { opacity: [[0, () => 0, 'easeOut'], [1, at('opacity')]] } },
  { id: 'slideInLeft', group: 'in', icon: 'arrowRight', tracks: { x: [[0, at('x', (v) => v - SLIDE), 'easeOut'], [1, at('x')]], opacity: [[0, () => 0, 'easeOut'], [0.6, at('opacity')]] } },
  { id: 'slideInRight', group: 'in', icon: 'chevronLeft', tracks: { x: [[0, at('x', (v) => v + SLIDE), 'easeOut'], [1, at('x')]], opacity: [[0, () => 0, 'easeOut'], [0.6, at('opacity')]] } },
  { id: 'slideInUp', group: 'in', icon: 'arrowUp', tracks: { y: [[0, at('y', (v) => v + SLIDE * 0.6), 'easeOut'], [1, at('y')]], opacity: [[0, () => 0, 'easeOut'], [0.6, at('opacity')]] } },
  { id: 'popIn', group: 'in', icon: 'sparkle', tracks: { scaleX: [[0, () => 0, 'backOut'], [1, at('scaleX')]], scaleY: [[0, () => 0, 'backOut'], [1, at('scaleY')]], opacity: [[0, () => 0, 'easeOut'], [0.3, at('opacity')]] } },
  { id: 'zoomIn', group: 'in', icon: 'maximize', tracks: { scaleX: [[0, at('scaleX', (v) => v * 1.6), 'easeOut'], [1, at('scaleX')]], scaleY: [[0, at('scaleY', (v) => v * 1.6), 'easeOut'], [1, at('scaleY')]], opacity: [[0, () => 0, 'easeOut'], [0.7, at('opacity')]] } },
  { id: 'dropIn', group: 'in', icon: 'arrowDown', tracks: { y: [[0, at('y', (v) => v - SLIDE), 'bounce'], [1, at('y')]], opacity: [[0, () => 0, 'easeOut'], [0.25, at('opacity')]] } },
  { id: 'pulse', group: 'emphasis', icon: 'record', tracks: { scaleX: [[0, at('scaleX'), 'easeInOut'], [0.5, at('scaleX', (v) => v * 1.12), 'easeInOut'], [1, at('scaleX')]], scaleY: [[0, at('scaleY'), 'easeInOut'], [0.5, at('scaleY', (v) => v * 1.12), 'easeInOut'], [1, at('scaleY')]] } },
  { id: 'shake', group: 'emphasis', icon: 'workArea', tracks: { x: [[0, at('x'), 'linear'], [0.1, at('x', (v) => v - 14), 'linear'], [0.3, at('x', (v) => v + 14), 'linear'], [0.5, at('x', (v) => v - 9), 'linear'], [0.7, at('x', (v) => v + 9), 'linear'], [0.85, at('x', (v) => v - 4), 'linear'], [1, at('x')]] } },
  { id: 'bounce', group: 'emphasis', icon: 'arrowUp', tracks: { y: [[0, at('y'), 'easeOut'], [0.35, at('y', (v) => v - 48), 'bounce'], [1, at('y')]] } },
  { id: 'float', group: 'emphasis', icon: 'curve', tracks: { y: [[0, at('y'), 'easeInOut'], [0.5, at('y', (v) => v - 18), 'easeInOut'], [1, at('y')]] } },
  { id: 'wobble', group: 'emphasis', icon: 'refresh', tracks: { rotation: [[0, at('rotation'), 'easeInOut'], [0.2, at('rotation', (v) => v - 9), 'easeInOut'], [0.4, at('rotation', (v) => v + 7), 'easeInOut'], [0.6, at('rotation', (v) => v - 5), 'easeInOut'], [0.8, at('rotation', (v) => v + 2), 'easeInOut'], [1, at('rotation')]] } },
  { id: 'spin', group: 'emphasis', icon: 'repeat', tracks: { rotation: [[0, at('rotation'), 'easeInOut'], [1, at('rotation', (v) => v + 360)]] } },
  { id: 'flash', group: 'emphasis', icon: 'bolt', tracks: { opacity: [[0, at('opacity'), 'linear'], [0.25, () => 0.15, 'linear'], [0.5, at('opacity'), 'linear'], [0.75, () => 0.15, 'linear'], [1, at('opacity')]] } },
  { id: 'fadeOut', group: 'out', icon: 'eyeOff', tracks: { opacity: [[0, at('opacity'), 'easeIn'], [1, () => 0]] } },
  { id: 'slideOutLeft', group: 'out', icon: 'chevronLeft', tracks: { x: [[0, at('x'), 'easeIn'], [1, at('x', (v) => v - SLIDE)]], opacity: [[0.4, at('opacity'), 'easeIn'], [1, () => 0]] } },
  { id: 'slideOutRight', group: 'out', icon: 'arrowRight', tracks: { x: [[0, at('x'), 'easeIn'], [1, at('x', (v) => v + SLIDE)]], opacity: [[0.4, at('opacity'), 'easeIn'], [1, () => 0]] } },
  { id: 'shrinkOut', group: 'out', icon: 'minus', tracks: { scaleX: [[0, at('scaleX'), 'easeIn'], [1, () => 0]], scaleY: [[0, at('scaleY'), 'easeIn'], [1, () => 0]], opacity: [[0.6, at('opacity'), 'easeIn'], [1, () => 0]] } },
];

/**
 * Write an animation preset as keyframes on the element, starting at the playhead: keys of
 * the same properties inside that time span are replaced; the clip grows to fit.
 */
export function applyAnimPreset(session: ProjectSession, nodeId: string, layerId: string, preset: AnimPreset, duration: number, label: string, start?: number): void {
  updateScene(session, nodeId, label, (s) => {
    const clipId = ensureClip(session, nodeId, s);
    const clip = s.animations.find((a) => a.id === clipId)!;
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const t0 = Math.max(0, start ?? session.sceneUI(nodeId).time);
    const cur = animatedProps(session.engine, s, layer, clipId, t0);
    const base: Base = {};
    for (const k of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']) base[k] = Number(cur[k] ?? layer.props[k] ?? (k.startsWith('scale') || k === 'opacity' ? 1 : 0));
    for (const [prop, keys] of Object.entries(preset.tracks)) {
      let track = clip.tracks.find((tr) => tr.layerId === layerId && tr.prop === prop);
      if (!track) { track = { id: newId('trk'), layerId, prop, keyframes: [] }; clip.tracks.push(track); }
      const t1 = t0 + duration;
      track.keyframes = track.keyframes.filter((k) => k.t < t0 - 1e-3 || k.t > t1 + 1e-3);
      for (const [pos, val, ease] of keys) track.keyframes.push({ id: newId('key'), t: Math.round((t0 + pos * duration) * 1000) / 1000, v: Math.round(val(base) * 1000) / 1000, ease: ease || 'easeInOut' });
      normalizeTrack(track);
      clip.duration = Math.max(clip.duration, Math.ceil(t1 * 10) / 10);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Style presets                                                        */
/* ------------------------------------------------------------------ */

export interface StylePreset { id: string; swatch: { bg: string; fg?: string; border?: string; radius?: number; glow?: string }; props: Record<string, any> }

export const STYLE_PRESETS: Record<string, StylePreset[]> = {
  'core.text': [
    { id: 'title', swatch: { bg: '#20222c', fg: '#ffffff' }, props: { fontSize: 72, fontWeight: 'bold', color: '#ffffff', letterSpacing: 2, shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 12, strokeWidth: 0 } },
    { id: 'subtitle', swatch: { bg: '#20222c', fg: '#e6e3f2' }, props: { fontSize: 40, fontWeight: 'normal', color: '#e6e3f2', letterSpacing: 0, shadowColor: 'rgba(0,0,0,0.5)', shadowBlur: 6, strokeWidth: 0 } },
    { id: 'caption', swatch: { bg: '#20222c', fg: '#bdb9cc' }, props: { fontSize: 24, fontWeight: 'normal', italic: true, color: '#c9c6d6', shadowBlur: 0, strokeWidth: 0 } },
    { id: 'outline', swatch: { bg: '#ffffff', fg: '#1b1b2a', border: '#1b1b2a' }, props: { fontSize: 56, fontWeight: 'bold', color: '#ffffff', strokeColor: '#1b1b2a', strokeWidth: 6, shadowBlur: 0 } },
    { id: 'neon', swatch: { bg: '#0b0b18', fg: '#7df9ff', glow: '#00e5ff' }, props: { fontWeight: 'bold', color: '#7df9ff', shadowColor: '#00e5ff', shadowBlur: 24, strokeWidth: 0 } },
    { id: 'warm', swatch: { bg: '#2a1c16', fg: '#ffd9a8' }, props: { color: '#ffd9a8', shadowColor: 'rgba(120,40,0,0.7)', shadowBlur: 10, strokeWidth: 0 } },
  ],
  'core.shape': [
    { id: 'card', swatch: { bg: 'rgba(20,22,32,0.9)', border: 'rgba(255,255,255,0.18)', radius: 6 }, props: { fill: 'rgba(20,22,32,0.86)', stroke: 'rgba(255,255,255,0.14)', strokeWidth: 1, radius: 18, gradient: 'none' } },
    { id: 'glass', swatch: { bg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.45)', radius: 8 }, props: { fill: 'rgba(255,255,255,0.12)', stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1.5, radius: 24, gradient: 'none' } },
    { id: 'outlineShape', swatch: { bg: 'transparent', border: '#ffffff', radius: 3 }, props: { fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 3, radius: 8, gradient: 'none' } },
    { id: 'accent', swatch: { bg: '#6c5ce7', radius: 4 }, props: { fill: '#6c5ce7', strokeWidth: 0, radius: 12, gradient: 'none' } },
    { id: 'shade', swatch: { bg: 'rgba(0,0,0,0.6)', radius: 0 }, props: { fill: 'rgba(0,0,0,0.55)', strokeWidth: 0, radius: 0, gradient: 'none' } },
  ],
  'core.button': [
    { id: 'primary', swatch: { bg: '#5d6cf0', fg: '#ffffff', radius: 5 }, props: { fill: '#5d6cf0', hoverFill: '#7683ff', textColor: '#ffffff', radius: 12 } },
    { id: 'ghost', swatch: { bg: 'rgba(255,255,255,0.08)', fg: '#ffffff', border: 'rgba(255,255,255,0.3)', radius: 5 }, props: { fill: 'rgba(255,255,255,0.06)', hoverFill: 'rgba(255,255,255,0.16)', textColor: '#ffffff', radius: 12 } },
    { id: 'pill', swatch: { bg: '#2a2d3a', fg: '#ffffff', radius: 12 }, props: { fill: 'rgba(30,32,44,0.9)', hoverFill: 'rgba(60,64,86,0.95)', textColor: '#ffffff', radius: 40 } },
    { id: 'light', swatch: { bg: '#f3f1fa', fg: '#1d1d29', radius: 5 }, props: { fill: '#f3f1fa', hoverFill: '#ffffff', textColor: '#1d1d29', radius: 12 } },
    { id: 'danger', swatch: { bg: '#d9485f', fg: '#ffffff', radius: 5 }, props: { fill: '#d9485f', hoverFill: '#ef5f75', textColor: '#ffffff', radius: 12 } },
  ],
  'core.freeDialogue': [
    { id: 'classic', swatch: { bg: 'rgba(12,14,24,0.9)', fg: '#ffffff', border: 'rgba(255,255,255,0.25)', radius: 5 }, props: { shape: 'rounded', fill: 'rgba(12,14,24,0.86)', stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1, radius: 14, color: '#ffffff', boxShadowBlur: 0, italic: false } },
    { id: 'speech', swatch: { bg: '#ffffff', fg: '#1d1d29', border: '#1d1d29', radius: 8 }, props: { shape: 'bubble', fill: '#ffffff', stroke: '#1d1d29', strokeWidth: 3, color: '#1d1d29', boxShadowBlur: 0, italic: false } },
    { id: 'thought', swatch: { bg: '#ffffff', fg: '#1d1d29', border: '#1d1d29', radius: 12 }, props: { shape: 'thought', fill: '#ffffff', stroke: '#1d1d29', strokeWidth: 2, color: '#1d1d29', italic: true, boxShadowBlur: 0 } },
    { id: 'neonBox', swatch: { bg: '#0b0716', fg: '#ffe8fb', border: '#ff4fd8', glow: '#ff4fd8', radius: 5 }, props: { shape: 'rounded', fill: 'rgba(8,6,20,0.9)', stroke: '#ff4fd8', strokeWidth: 2, boxShadowColor: '#ff4fd8', boxShadowBlur: 18, color: '#ffe8fb', italic: false } },
    { id: 'paper', swatch: { bg: '#f4ead5', fg: '#3b2f22', border: '#b89f78', radius: 2 }, props: { shape: 'rect', fill: '#f4ead5', stroke: '#b89f78', strokeWidth: 2, color: '#3b2f22', boxShadowBlur: 0, italic: false } },
    { id: 'bare', swatch: { bg: 'transparent', fg: '#ffffff' }, props: { shape: 'none', color: '#ffffff', textShadowColor: 'rgba(0,0,0,0.85)', textShadowBlur: 8 } },
  ],
};

/** Properties a saved look leaves out: where the element is and what it says or shows. */
const NOT_STYLE = new Set(['x', 'y', 'text', 'assetId', 'lines', 'speaker', 'points', 'characterId', 'portraitId', 'frames', 'frame', 'listVar', 'requiresItem']);

export interface ElementPreset { id: string; name: string; layerType: string; props: Record<string, any>; effect?: any; blend?: string }

let elCache: ElementPreset[] | null = null;
const elListeners = new Set<() => void>();
async function loadElementPresets(force = false): Promise<ElementPreset[]> {
  if (elCache && !force) return elCache;
  try { elCache = (await call('elementPresets.list')) || []; } catch { elCache = elCache || []; }
  for (const l of elListeners) l();
  return elCache!;
}
function useElementPresets(): ElementPreset[] | null {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump((n) => n + 1); elListeners.add(l); if (!elCache) loadElementPresets(); return () => { elListeners.delete(l); }; }, []);
  return elCache;
}

export function applyStyle(session: ProjectSession, nodeId: string, layerId: string, props: Record<string, any>, label: string, extra?: { effect?: any; blend?: string }): void {
  const layer = session.project.nodes[nodeId] && (session.project.nodes[nodeId].data as SceneData).layers?.find((l) => l.id === layerId);
  if (!layer) return;
  const keys = new Set(session.engine.layerProps(layer.type).map((p) => p.key));
  updateScene(session, nodeId, label, (s) => {
    const l = s.layers.find((x) => x.id === layerId);
    if (!l) return;
    for (const [k, v] of Object.entries(props)) if (keys.has(k)) l.props[k] = v;
    if (extra?.effect) l.effect = JSON.parse(JSON.stringify(extra.effect));
    if (extra && 'blend' in extra) l.blend = extra.blend;
  });
}

/* ------------------------------------------------------------------ */
/* Presets tab                                                          */
/* ------------------------------------------------------------------ */

export function PresetsTab({ session, nodeId, scene, layer }: { session: ProjectSession; nodeId: string; scene: SceneData; layer: Layer }) {
  const t = useT();
  const def = session.engine.layerTypes.get(layer.type);
  const [dur, setDur] = useState(() => Number(localStorage.getItem('vne.anim.presetDuration')) || 0.6);
  const mine = useElementPresets();
  const ui = session.sceneUI(nodeId);
  const visual = def?.visual !== false;
  const styles = STYLE_PRESETS[layer.type] || [];
  const ours = (mine || []).filter((p) => p.layerType === layer.type);

  const saveLook = async () => {
    const name = (await store.prompt(t('insp.saveLookTitle'), t('insp.saveLookName'), layer.name))?.trim();
    if (!name) return;
    const props: Record<string, any> = {};
    for (const p of session.engine.layerProps(layer.type)) if (!NOT_STYLE.has(p.key) && layer.props[p.key] !== undefined) props[p.key] = layer.props[p.key];
    const same = ours.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same && !(await store.confirm(t('fxp.replaceTitle'), t('fxp.replaceText', { name: same.name }), t('fxp.replace')))) return;
    try {
      await call('elementPresets.save', { preset: { id: same?.id || newId('elp'), name, layerType: layer.type, props, ...(layer.effect ? { effect: layer.effect.kind === 'inline' ? layer.effect : { kind: 'inline', graph: effectGraphOf(session.project, layer.effect) } } : {}), ...(layer.blend ? { blend: layer.blend } : {}) } });
      await loadElementPresets(true);
      store.toast(t('insp.lookSaved', { name }), 'success');
    } catch (e: any) { store.toast(`${t('fxp.saveFailed')}: ${e?.message || e}`, 'error'); }
  };
  const removeLook = async (p: ElementPreset) => {
    if (!(await store.confirm(t('fxp.deleteTitle'), t('fxp.deleteText', { name: p.name }), t('common.delete'), true))) return;
    await call('elementPresets.delete', { id: p.id });
    await loadElementPresets(true);
  };

  return (
    <>
      {visual && (
        <Section id="insp.presets.anim" title={t('insp.animPresets')} tip={t('insp.animPresetsTip')}>
          <div className="anim-preset-head">
            <Field label={t('insp.presetLength')}><NumberInput value={dur} min={0.1} max={10} step={0.1} unit="s" onChange={(v) => { setDur(v); try { localStorage.setItem('vne.anim.presetDuration', String(v)); } catch { /* ignore */ } }} /></Field>
            <span className="muted small">{t('insp.presetStartsAt', { time: ui.time.toFixed(2) })}</span>
          </div>
          {(['in', 'emphasis', 'out'] as const).map((g) => (
            <div key={g} className="anim-group">
              <div className="anim-group-title">{t(`insp.anim.${g}`)}</div>
              <div className="chip-wrap">
                {ANIM_PRESETS.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} type="button" className="chip-btn" onClick={() => applyAnimPreset(session, nodeId, layer.id, p, dur, t('insp.applyAnim', { name: t(`anim.preset.${p.id}`) }))} title={t('insp.applyAnimHint')}>
                    <Icon name={p.icon} size={13} />{t(`anim.preset.${p.id}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}
      {styles.length > 0 && (
        <Section id="insp.presets.style" title={t('insp.stylePresets')} tip={t('insp.stylePresetsTip')}>
          <div className="preset-grid">
            {styles.map((p) => (
              <button key={p.id} type="button" className="preset-card" onClick={() => applyStyle(session, nodeId, layer.id, p.props, t('insp.applyStyle', { name: t(`style.preset.${p.id}`) }))}>
                <span className="preset-swatch" style={{ background: p.swatch.bg, color: p.swatch.fg, borderColor: p.swatch.border || 'transparent', borderRadius: p.swatch.radius ?? 4, boxShadow: p.swatch.glow ? `0 0 10px ${p.swatch.glow}` : undefined }}>{p.swatch.fg ? 'Aa' : ''}</span>
                <span className="preset-name">{t(`style.preset.${p.id}`)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section id="insp.presets.mine" title={t('insp.myLooks')} tip={t('insp.myLooksTip')} actions={<IconButton icon="bookmarkPlus" size={14} title={t('insp.saveLook')} onClick={saveLook} />}>
        {mine === null ? <p className="muted small">{t('common.loading')}</p>
          : !ours.length ? <div className="muted small">{t('insp.noLooks')} <Button small icon="bookmarkPlus" onClick={saveLook}>{t('insp.saveLook')}</Button></div>
            : <div className="preset-list">{ours.map((p) => (
              <div key={p.id} className="preset-row">
                <button type="button" className="preset-row-main" onClick={() => applyStyle(session, nodeId, layer.id, p.props, t('insp.applyStyle', { name: p.name }), { effect: p.effect, blend: p.blend })}>
                  <Icon name="bookmark" size={13} /><span className="preset-name">{p.name}</span><span className="preset-apply">{t('insp.apply')}</span>
                </button>
                <IconButton icon="trash" size={13} title={t('common.delete')} onClick={() => removeLook(p)} />
              </div>
            ))}</div>}
      </Section>
      {layer.type === 'core.character' && <CharacterPresetsSection session={session} nodeId={nodeId} layer={layer} />}
      <ScenePresetsSection session={session} nodeId={nodeId} scene={scene} selected={ui.selectedLayers} />
      {layer.type !== 'core.character' && <CharacterPresetsSection session={session} nodeId={nodeId} layer={null} />}
    </>
  );
}
