import type { SceneData, Layer, Project, Track, AnimationClip, Block, Engine, ScriptStack } from '@vne/core';
import { newId, createAnimation, createLayer, remapIds, isBlockRef, choiceLayers, syncSceneChoiceEdges, CHOICE_LAYER, DIALOGUE_LAYER, CHOICE_STYLE, hasSceneData } from '@vne/core';
import { normalizeTrack, sampleTrack, propKind, animatedProps } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { store } from '../state/store';

export function sceneOf(session: ProjectSession, nodeId: string): SceneData | null {
  const n = session.project.nodes[nodeId];
  return hasSceneData(n) ? (n.data as SceneData) : null;
}

export function updateScene(session: ProjectSession, nodeId: string, label: string, fn: (scene: SceneData, draft: Project) => void, mergeKey?: string): void {
  session.update(label, (d) => {
    const n = d.nodes[nodeId];
    if (!hasSceneData(n)) return;
    // Choice elements are the scene's outputs: keep story connections in sync with them.
    const before = choiceLayers(n.data as SceneData).map((l) => l.id);
    fn(n.data as SceneData, d);
    const after = choiceLayers(n.data as SceneData).map((l) => l.id);
    if (before.length !== after.length || before.some((id, i) => id !== after[i])) syncSceneChoiceEdges(d, nodeId, before);
  }, mergeKey ? { mergeKey } : undefined);
}

/** Ensure a clip is selected for keyframing; creates "Animation 1" when the scene has none. */
export function ensureClip(session: ProjectSession, nodeId: string, draftScene?: SceneData): string {
  const ui = session.sceneUI(nodeId);
  const scene = draftScene || sceneOf(session, nodeId)!;
  if (ui.clipId && scene.animations.some((a) => a.id === ui.clipId)) return ui.clipId;
  if (scene.animations[0]) { session.setSceneUI(nodeId, { clipId: scene.animations[0].id }); return scene.animations[0].id; }
  const clip = createAnimation(session.i18n.t('anim.defaultName', { n: 1 }), 3);
  clip.autoplay = true;
  if (draftScene) draftScene.animations.push(clip);
  else updateScene(session, nodeId, session.i18n.t('anim.add'), (s) => { s.animations.push(clip); });
  session.setSceneUI(nodeId, { clipId: clip.id });
  return clip.id;
}

function upsertKey(track: Track, time: number, value: any, ease = 'easeInOut'): void {
  const k = track.keyframes.find((x) => Math.abs(x.t - time) < 1e-3);
  if (k) k.v = value;
  else { track.keyframes.push({ id: newId('key'), t: time, v: value, ease }); normalizeTrack(track); }
}

/**
 * Set layer properties from the inspector or the canvas. When the property is
 * animated in the current clip (or record mode is on), the value is written as
 * a keyframe at the playhead instead of changing the base value — like After Effects.
 */
export function setLayerProps(session: ProjectSession, nodeId: string, layerId: string, patch: Record<string, any>, opts: { mergeKey?: string; label?: string } = {}): void {
  const ui = session.sceneUI(nodeId);
  const t = session.i18n.t;
  const engine = session.engine;
  updateScene(session, nodeId, opts.label || t('layer.edit'), (s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const clip = ui.clipId ? s.animations.find((a) => a.id === ui.clipId) : null;
    const defs = engine.layerProps(layer.type);
    for (const [k, v] of Object.entries(patch)) {
      const def = defs.find((p) => p.key === k);
      const animatable = def?.animatable || k.startsWith('fx.');
      let track = clip?.tracks.find((tr) => tr.layerId === layerId && tr.prop === k);
      if (animatable && clip && (track || ui.record)) {
        if (!track) {
          track = { id: newId('trk'), layerId, prop: k, keyframes: [] };
          clip.tracks.push(track);
          // first key at time 0 holds the current base value so the change animates from it
          if (ui.time > 0.001) track.keyframes.push({ id: newId('key'), t: 0, v: layer.props[k] ?? def?.default ?? 0, ease: 'easeInOut' });
        }
        upsertKey(track, Math.max(0, ui.time), v);
        if (ui.time > clip.duration) clip.duration = Math.ceil(ui.time * 10) / 10;
      } else layer.props[k] = v;
    }
  }, opts.mergeKey);
}

export function toggleKey(session: ProjectSession, nodeId: string, layerId: string, prop: string): void {
  const t = session.i18n.t;
  const scene = sceneOf(session, nodeId);
  if (!scene) return;
  updateScene(session, nodeId, t('timeline.toggleKey'), (s) => {
    const clipId = ensureClip(session, nodeId, s);
    const clip = s.animations.find((a) => a.id === clipId)!;
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const time = session.sceneUI(nodeId).time;
    let track = clip.tracks.find((tr) => tr.layerId === layerId && tr.prop === prop);
    const existing = track?.keyframes.find((k) => Math.abs(k.t - time) < 1e-3);
    if (track && existing) {
      track.keyframes = track.keyframes.filter((k) => k !== existing);
      if (!track.keyframes.length) clip.tracks = clip.tracks.filter((x) => x !== track);
      return;
    }
    const current = animatedProps(session.engine, s, layer, clipId, time)[prop] ?? layer.props[prop];
    if (!track) { track = { id: newId('trk'), layerId, prop, keyframes: [] }; clip.tracks.push(track); }
    upsertKey(track, time, current);
    if (time > clip.duration) clip.duration = Math.ceil(time * 10) / 10;
  });
}

export function keyStateFor(session: ProjectSession, scene: SceneData, layerId: string, prop: string): 'none' | 'animated' | 'key' {
  const ui = session.sceneUI(session.currentNodeId || '');
  const clip = scene.animations.find((a) => a.id === ui.clipId);
  const track = clip?.tracks.find((tr) => tr.layerId === layerId && tr.prop === prop);
  if (!track || !track.keyframes.length) return 'none';
  return track.keyframes.some((k) => Math.abs(k.t - ui.time) < 1e-3) ? 'key' : 'animated';
}

export function valueAt(session: ProjectSession, track: Track, time: number): any {
  return sampleTrack(session.engine, track, time, propKind(undefined, track.keyframes[0]?.v));
}

export function addLayer(session: ProjectSession, nodeId: string, type: string, extra: Record<string, any> = {}, name?: string, fields?: { visible?: boolean }): string | null {
  const t = session.i18n.t;
  const scene = sceneOf(session, nodeId);
  if (!scene) return null;
  const def = session.engine.layerTypes.get(type);
  // A scene has one dialogue element.
  const existingDialogue = type === DIALOGUE_LAYER ? scene.layers.find((l) => l.type === DIALOGUE_LAYER) : null;
  if (existingDialogue) { session.setSceneUI(nodeId, { selectedLayers: [existingDialogue.id] }); return existingDialogue.id; }
  if (type === CHOICE_LAYER) {
    const { width: W, height: H } = session.project.settings.resolution;
    const n = scene.layers.filter((l) => l.type === CHOICE_LAYER).length;
    extra = { x: W / 2, y: Math.round(H * 0.3 + n * (CHOICE_STYLE.height + 16)), text: t('choice.new', { n: n + 1 }), ...extra };
  }
  const base = name || (type === CHOICE_LAYER ? String(extra.text) : def ? t(def.label) : type);
  let n = 1;
  while (scene.layers.some((l) => l.name === (n === 1 ? base : `${base} ${n}`))) n++;
  const layer = createLayer(session.engine, session.project, type, n === 1 ? base : `${base} ${n}`, extra);
  if (fields?.visible !== undefined) layer.visible = fields.visible;
  // New layers go above the selection (or on top).
  const sel = session.sceneUI(nodeId).selectedLayers[0];
  updateScene(session, nodeId, t('layer.add'), (s) => {
    const i = sel ? s.layers.findIndex((l) => l.id === sel) : -1;
    if (i >= 0) { layer.parentId = s.layers[i].type === 'core.group' ? s.layers[i].id : s.layers[i].parentId; s.layers.splice(i + 1, 0, layer); }
    else if (type === 'core.background') s.layers.unshift(layer);
    else s.layers.push(layer);
  });
  session.setSceneUI(nodeId, { selectedLayers: [layer.id] });
  return layer.id;
}

/**
 * Remove layers and everything that references them inside the scene (tracks, media
 * clips, children). Elements are bound to Interactions: if scripts use them, ask first;
 * scripts started by a deleted element are removed and other blocks lose the reference.
 */
export async function deleteLayers(session: ProjectSession, nodeId: string, ids: string[]): Promise<void> {
  const t = session.i18n.t;
  const scene = sceneOf(session, nodeId);
  if (!scene) return;
  const all = new Set(ids);
  let grew = true;
  while (grew) { grew = false; for (const l of scene.layers) if (l.parentId && all.has(l.parentId) && !all.has(l.id)) { all.add(l.id); grew = true; } }
  const usage = elementUsage(session.engine, scene.scripts, all);
  if (usage.scripts) {
    const names = scene.layers.filter((l) => all.has(l.id)).map((l) => l.name).slice(0, 3).join(', ');
    const ok = await store.confirm(t('layer.deleteUsedTitle'), t('layer.deleteUsedText', { names, n: usage.scripts, hats: usage.hatScripts.size }), t('common.delete'), true);
    if (!ok) return;
  }
  updateScene(session, nodeId, t('layer.delete'), (s) => {
    s.layers = s.layers.filter((l) => !all.has(l.id));
    for (const a of s.animations) { a.tracks = a.tracks.filter((tr) => !all.has(tr.layerId)); a.media = a.media.filter((m) => !all.has(m.layerId)); }
    s.scripts = s.scripts.filter((st) => !usage.hatScripts.has(st.id));
    for (const st of s.scripts) forEachBlock([st.hat, ...st.body], (b) => {
      const def = session.engine.blocks.get(b.type);
      for (const arg of def?.args || []) if (arg.type === 'layer' && all.has(b.args[arg.id] as string)) b.args[arg.id] = null;
    });
  });
  session.setSceneUI(nodeId, { selectedLayers: [] });
}

/** Visit every block, including blocks inside C blocks and inside other blocks' slots. */
export function forEachBlock(blocks: (Block | null | undefined)[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    if (!b) continue;
    fn(b);
    for (const v of Object.values(b.args || {})) if (isBlockRef(v)) forEachBlock([v.block], fn);
    if (b.body) forEachBlock(b.body, fn);
    if (b.else) forEachBlock(b.else, fn);
  }
}

/** How a scene's scripts use some elements: scripts that mention them, and scripts whose trigger is one of them. */
export function elementUsage(engine: Engine, scripts: ScriptStack[], ids: Set<string>): { scripts: number; hatScripts: Set<string>; byElement: Map<string, number> } {
  const hatScripts = new Set<string>();
  const byElement = new Map<string, number>();
  let n = 0;
  for (const st of scripts) {
    const used = new Set<string>();
    forEachBlock([st.hat, ...st.body], (b) => {
      const def = engine.blocks.get(b.type);
      for (const arg of def?.args || []) {
        const v = b.args[arg.id];
        if (arg.type === 'layer' && typeof v === 'string' && ids.has(v)) { used.add(v); if (b === st.hat) hatScripts.add(st.id); }
      }
    });
    if (used.size) n++;
    for (const id of used) byElement.set(id, (byElement.get(id) || 0) + 1);
  }
  return { scripts: n, hatScripts, byElement };
}

export function duplicateLayers(session: ProjectSession, nodeId: string, ids: string[]): void {
  const t = session.i18n.t;
  const scene = sceneOf(session, nodeId);
  if (!scene) return;
  const created: string[] = [];
  updateScene(session, nodeId, t('layer.duplicate'), (s) => {
    for (const id of ids) {
      const i = s.layers.findIndex((l) => l.id === id);
      if (i < 0) continue;
      const src = JSON.parse(JSON.stringify(s.layers[i])) as Layer;
      const copy = remapIds(src).value as Layer;
      copy.id = newId('lyr');
      copy.name = `${src.name} ${t('common.copySuffix')}`;
      copy.parentId = src.parentId;
      if (copy.props.x !== undefined) { copy.props.x += 24; copy.props.y += 24; }
      s.layers.splice(i + 1, 0, copy);
      created.push(copy.id);
    }
  });
  session.setSceneUI(nodeId, { selectedLayers: created });
}

export function clipOf(scene: SceneData, id: string | null): AnimationClip | null {
  return scene.animations.find((a) => a.id === id) || null;
}

/** Layers in display order for the layer panel: top-most first, children under their group. */
export function layerTree(scene: SceneData): { layer: Layer; depth: number }[] {
  const out: { layer: Layer; depth: number }[] = [];
  const ids = new Set(scene.layers.map((l) => l.id));
  const walk = (parent: string | null, depth: number) => {
    const kids = scene.layers.filter((l) => (parent === null ? !l.parentId || !ids.has(l.parentId) : l.parentId === parent));
    for (let i = kids.length - 1; i >= 0; i--) {
      out.push({ layer: kids[i], depth });
      if (kids[i].type === 'core.group') walk(kids[i].id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
