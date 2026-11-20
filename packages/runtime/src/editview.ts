import type { Engine, Layer, LayerInstance, Project, SceneData, VarScope } from '@vne/core';
import { sampleClip } from './animation';
import type { SceneView } from './render';
import { computeDrives } from './render';
import type { AssetLoader } from './assets';
import type { CanvasPool, ShaderRunner } from './effects';

export interface EditViewOptions {
  engine: Engine;
  project: Project;
  scene: SceneData;
  assets: AssetLoader;
  pool: CanvasPool;
  shaders: ShaderRunner;
  /** Playhead time in seconds. */
  time: number;
  /** Animation clip ids sampled at `time`, in order (later wins). */
  clipIds: string[];
  vars: VarScope;
  instances?: Map<string, LayerInstance>;
  /** Hide layers (e.g. editor "solo" or temporary hide). */
  hidden?: Set<string>;
}

/**
 * Builds the SceneView the editor composition canvas draws. It uses exactly the
 * same renderer and the same animation sampling as the game, so what you see
 * while editing is what the player gets.
 */
export function createEditView(o: EditViewOptions): SceneView {
  const anim = new Map<string, Record<string, any>>();
  const propDef = (layerId: string, prop: string) => {
    const l = o.scene.layers.find((x) => x.id === layerId);
    return l ? o.engine.layerProps(l.type).find((p) => p.key === prop) : undefined;
  };
  for (const id of o.clipIds) {
    const clip = o.scene.animations.find((a) => a.id === id);
    if (clip) sampleClip(o.engine, clip, Math.min(o.time, Math.max(clip.duration, 0)), propDef, anim);
  }
  let drives = new Map<string, Record<string, any>>();
  const view: SceneView = {
    engine: o.engine,
    project: o.project,
    assets: o.assets,
    layers: o.scene.layers,
    mode: 'edit',
    time: o.time,
    vars: o.vars,
    props: (l: Layer) => {
      const a = anim.get(l.id);
      const d = drives.get(l.id);
      if (!a && !d) return l.props;
      return { ...l.props, ...(a || {}), ...(d || {}) };
    },
    visible: (l: Layer) => l.visible && !o.hidden?.has(l.id),
    instance: (id: string) => o.instances?.get(id),
    pool: o.pool,
    shaders: o.shaders,
    errors: new Map(),
  };
  drives = computeDrives(view);
  return view;
}

/** Props with animation applied at time t, for the inspector ("current value at playhead"). */
export function animatedProps(engine: Engine, scene: SceneData, layer: Layer, clipId: string | null, time: number): Record<string, any> {
  if (!clipId) return layer.props;
  const clip = scene.animations.find((a) => a.id === clipId);
  if (!clip) return layer.props;
  const out = sampleClip(engine, clip, time, (lid, prop) => (lid === layer.id ? engine.layerProps(layer.type).find((p) => p.key === prop) : undefined));
  return { ...layer.props, ...(out.get(layer.id) || {}) };
}
