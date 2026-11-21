import type { Engine, Layer, LayerInstance, Project, VarScope, EffectGraph } from '@vne/core';
import { layerMatrix, multiply, invert, apply, IDENTITY, Mat, num } from './math';
import type { AssetLoader } from './assets';
import { CanvasPool, ShaderRunner, evaluateEffectGraph, ctx2d, graphParamDefaults, Canvas } from './effects';

/** Everything needed to draw one scene frame. Shared by the editor canvas and the game. */
export interface SceneView {
  engine: Engine;
  project: Project;
  assets: AssetLoader;
  layers: Layer[];
  mode: 'edit' | 'play';
  time: number;
  vars: VarScope;
  /** Evaluated properties (base + animation + script overrides). */
  props(layer: Layer): Record<string, any>;
  visible(layer: Layer): boolean;
  instance(layerId: string): LayerInstance | undefined;
  /** Playing scenes: how a choice element is shown (hover / disabled). Absent in the editor. */
  choiceState?(layerId: string): { hover: boolean; disabled: boolean } | null;
  pool: CanvasPool;
  shaders: ShaderRunner;
  /** Effect diagnostics collected during the frame. */
  errors: Map<string, string[]>;
  /** Hook for error reporting from module draw code. */
  reportError?(source: string, err: unknown): void;
  /** Playing games: the player's collectibles (inventories draw these). */
  items?: { list(listVar?: string | null): string[]; selected(): string | null };
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  view: SceneView;
  engine: Engine;
  assets: AssetLoader;
  project: Project;
  mode: 'edit' | 'play';
  time: number;
  /** Size of the layer being drawn (its local coordinate space is 0..width × 0..height). */
  width?: number;
  height?: number;
  /** Draw children of a group or a nested layer list in the current transform. */
  drawChildren(parentId: string | null, layers?: Layer[]): void;
}

export function layerSize(view: SceneView, layer: Layer, props: Record<string, any>): { width: number; height: number } {
  const def = view.engine.layerTypes.get(layer.type);
  if (def?.size) {
    try {
      return def.size(layer, props, { view, assets: view.assets, project: view.project, engine: view.engine, measure: measureCtx() });
    } catch (err) {
      view.reportError?.(`layer:${layer.type}`, err);
    }
  }
  return { width: num(props.width, 100), height: num(props.height, 100) };
}

let _measure: CanvasRenderingContext2D | null = null;
export function measureCtx(): CanvasRenderingContext2D {
  if (!_measure) _measure = ctx2d(typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(4, 4));
  return _measure;
}

export function childrenOf(layers: Layer[], parentId: string | null): Layer[] {
  if (parentId === null) {
    // Orphans (parent deleted or from a missing composition) render at the top level instead of vanishing.
    const ids = new Set(layers.map((l) => l.id));
    return layers.filter((l) => !l.parentId || !ids.has(l.parentId));
  }
  return layers.filter((l) => l.parentId === parentId);
}

/**
 * Transform of an element's linked parents ("parent & link"): each parent's anchor position,
 * rotation and scale, outermost first. Identity when the element has no (valid) parent link.
 * A link only counts between elements in the same group; loops are ignored.
 */
export function linkMatrixWith(layers: Layer[], layer: Layer, propsOf: (l: Layer) => Record<string, any>): Mat {
  if (!layer.link) return IDENTITY;
  const chain: Layer[] = [];
  const guard = new Set<string>([layer.id]);
  let cur: Layer | undefined = layer;
  while (cur?.link) {
    const p: Layer | undefined = layers.find((l) => l.id === cur!.link);
    if (!p || guard.has(p.id) || (p.parentId || null) !== (layer.parentId || null)) break;
    guard.add(p.id);
    chain.unshift(p);
    cur = p;
  }
  let m: Mat = IDENTITY;
  for (const p of chain) m = multiply(m, layerMatrix(propsOf(p), 0, 0));
  return m;
}

export function linkMatrix(view: SceneView, layer: Layer, layers: Layer[] = view.layers): Mat {
  return linkMatrixWith(layers, layer, (l) => view.props(l));
}

/** Matrix from the space an element's x/y are measured in (its group and linked parent) to stage coordinates. */
export function parentSpace(view: SceneView, layer: Layer): Mat {
  const base = layer.parentId && view.layers.some((l) => l.id === layer.parentId) ? worldMatrix(view, layer.parentId) : IDENTITY;
  return multiply(base, linkMatrix(view, layer));
}

/** Matrix from layer-local box coordinates to stage coordinates. */
export function worldMatrix(view: SceneView, layerId: string, layers: Layer[] = view.layers): Mat {
  const chain: Layer[] = [];
  let cur = layers.find((l) => l.id === layerId);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? layers.find((l) => l.id === cur!.parentId) : undefined;
  }
  let m: Mat = IDENTITY;
  for (const l of chain) {
    const p = view.props(l);
    const s = layerSize(view, l, p);
    if (l.link) m = multiply(m, linkMatrix(view, l, layers));
    m = multiply(m, layerMatrix(p, s.width, s.height));
  }
  return m;
}

export function layerCorners(view: SceneView, layer: Layer): { x: number; y: number }[] {
  const m = worldMatrix(view, layer.id);
  const s = layerSize(view, layer, view.props(layer));
  return [apply(m, 0, 0), apply(m, s.width, 0), apply(m, s.width, s.height), apply(m, 0, s.height)];
}

export function effectiveVisible(view: SceneView, layer: Layer): boolean {
  let cur: Layer | undefined = layer;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (!view.visible(cur)) return false;
    if (view.props(cur).__span === false) return false;
    const pid: string | null = cur.parentId;
    cur = pid ? view.layers.find((l) => l.id === pid) : undefined;
  }
  return true;
}

/** Topmost layer under a stage-space point. */
export function hitTest(view: SceneView, x: number, y: number, filter?: (l: Layer) => boolean): Layer | null {
  for (let i = view.layers.length - 1; i >= 0; i--) {
    const l = view.layers[i];
    const def = view.engine.layerTypes.get(l.type);
    if (def && !def.visual) continue;
    if (l.type === 'core.group') continue;
    if (filter && !filter(l)) continue;
    if (!effectiveVisible(view, l)) continue;
    if (layerContains(view, l, x, y)) return l;
  }
  return null;
}

/** True if the stage point is inside the layer (its shape when the layer type defines `hitTest`, else its rectangle). */
export function layerContains(view: SceneView, l: Layer, x: number, y: number): boolean {
  const m = invert(worldMatrix(view, l.id));
  if (!m) return false;
  const p = apply(m, x, y);
  const props = view.props(l);
  const s = layerSize(view, l, props);
  if (!(p.x >= 0 && p.y >= 0 && p.x <= s.width && p.y <= s.height)) return false;
  const def = view.engine.layerTypes.get(l.type);
  if (!def?.hitTest) return true;
  try { return !!def.hitTest(l, props, p.x, p.y, s); } catch { return true; }
}

/** A stage point in the layer's own coordinates (0..width, 0..height), with the layer's size. */
export function layerLocalPoint(view: SceneView, l: Layer, x: number, y: number): { x: number; y: number; size: { width: number; height: number } } | null {
  const m = invert(worldMatrix(view, l.id));
  if (!m) return null;
  const p = apply(m, x, y);
  return { x: p.x, y: p.y, size: layerSize(view, l, view.props(l)) };
}

/** Axis-aligned bounding box of a layer on the stage. */
export function layerBounds(view: SceneView, l: Layer): { x: number; y: number; width: number; height: number } {
  const c = layerCorners(view, l);
  const xs = c.map((q) => q.x), ys = c.map((q) => q.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Resolve a layer's effect graph (inline or referenced) and its parameters. */
export function layerEffect(project: Project, layer: Layer, props: Record<string, any>): { graph: EffectGraph; params: Record<string, any> } | null {
  const e = layer.effect;
  if (!e) return null;
  let graph: EffectGraph | undefined;
  let params: Record<string, any> = {};
  if (e.kind === 'inline') graph = e.graph;
  else {
    graph = project.effectGraphs.find((g) => g.id === e.graphId);
    params = { ...(e.params || {}) };
  }
  if (!graph || !graph.nodes.length) return null;
  const merged = { ...graphParamDefaults(graph), ...params };
  for (const p of graph.params) if (props[`fx.${p.id}`] !== undefined) merged[p.id] = props[`fx.${p.id}`];
  return { graph, params: merged };
}

/** Apply property drivers from effect graphs before drawing (relationships between properties/layers). */
export function computeDrives(view: SceneView): Map<string, Record<string, any>> {
  const out = new Map<string, Record<string, any>>();
  for (const l of view.layers) {
    if (!l.effect) continue;
    const props = view.props(l);
    const fx = layerEffect(view.project, l, props);
    if (!fx || !fx.graph.nodes.some((n) => view.engine.effectNodes.get(n.type)?.category === 'drive')) continue;
    const errors: string[] = [];
    const res = evaluateEffectGraph({ ...fx.graph, nodes: fx.graph.nodes.filter((n) => n.type !== 'fx.output') }, null, {
      engine: view.engine, pool: view.pool, shaders: view.shaders, time: view.time, vars: view.vars,
      layerProps: (id) => { const x = view.layers.find((y) => y.id === id); return x ? view.props(x) : undefined; },
      params: fx.params, selfId: l.id, selfProps: props, width: 1, height: 1, errors,
    });
    for (const d of res.drives) {
      let rec = out.get(d.layerId);
      if (!rec) out.set(d.layerId, (rec = {}));
      rec[d.prop] = d.value;
    }
    if (errors.length) view.errors.set(l.id, errors);
  }
  return out;
}

export function drawScene(ctx: CanvasRenderingContext2D, view: SceneView, background = '#000'): void {
  const { width, height } = view.project.settings.resolution;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  drawLayerList(ctx, view, null, view.layers);
}

export function drawLayerList(ctx: CanvasRenderingContext2D, view: SceneView, parentId: string | null, layers: Layer[]): void {
  for (const layer of childrenOf(layers, parentId)) drawLayer(ctx, view, layer, layers);
}

function drawLayer(ctx: CanvasRenderingContext2D, view: SceneView, layer: Layer, layers: Layer[]): void {
  if (!view.visible(layer)) return;
  const def = view.engine.layerTypes.get(layer.type);
  if (def && !def.visual) return;
  const props = view.props(layer);
  if (props.__span === false) return; // outside its in/out points in a playing animation
  const opacity = props.opacity === undefined ? 1 : num(props.opacity, 1);
  if (opacity <= 0 && view.mode === 'play') return;
  const size = layerSize(view, layer, props);
  const own = layerMatrix(props, size.width, size.height);
  const m = layer.link ? multiply(linkMatrix(view, layer, layers), own) : own;
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.globalAlpha *= Math.max(0, Math.min(1, opacity));
  if (layer.blend && layer.blend !== 'normal') ctx.globalCompositeOperation = layer.blend as GlobalCompositeOperation;

  const rc: RenderContext = {
    ctx, view, engine: view.engine, assets: view.assets, project: view.project, mode: view.mode, time: view.time,
    width: size.width, height: size.height,
    drawChildren: (pid, ls) => drawLayerList(ctx, view, pid, ls || layers),
  };

  // Property extensions (module-defined properties with draw hooks)
  const exts = view.engine.properties.list().filter((p) => p.apply && (p.layerTypes === '*' || p.layerTypes.includes(layer.type)) && props[p.prop.key] !== undefined);
  for (const e of exts) if (e.phase === 'before' || e.phase === 'transform') safe(view, e.owner || e.id, () => e.apply!(rc, layer, props, props[e.prop.key]));

  const fx = layerEffect(view.project, layer, props);
  if (!def) {
    drawMissing(ctx, size.width, size.height, layer.type);
  } else if (fx && size.width > 0 && size.height > 0 && layer.type !== 'core.group') {
    const pad = Math.max(0, Math.min(256, num(props['fx.padding'], 24)));
    const scale = Math.min(1, 2048 / Math.max(size.width + pad * 2, size.height + pad * 2));
    const buf = view.pool.acquire((size.width + pad * 2) * scale, (size.height + pad * 2) * scale);
    const bctx = ctx2d(buf);
    bctx.save();
    bctx.setTransform(scale, 0, 0, scale, pad * scale, pad * scale);
    const inner: RenderContext = { ...rc, ctx: bctx, drawChildren: (pid, ls) => drawLayerList(bctx, view, pid, ls || layers) };
    drawContent(inner, def, layer, props);
    bctx.restore();
    const errors: string[] = [];
    const res = evaluateEffectGraph(fx.graph, buf, {
      engine: view.engine, pool: view.pool, shaders: view.shaders, time: view.time, vars: view.vars,
      layerProps: (id) => { const x = view.layers.find((y) => y.id === id); return x ? view.props(x) : undefined; },
      params: fx.params, selfId: layer.id, selfProps: props, width: buf.width, height: buf.height, errors,
    });
    if (errors.length) view.errors.set(layer.id, errors);
    if (res.image) ctx.drawImage(res.image as any, -pad, -pad, size.width + pad * 2, size.height + pad * 2);
  } else {
    drawContent(rc, def, layer, props);
  }
  for (const e of exts) if (!e.phase || e.phase === 'after') safe(view, e.owner || e.id, () => e.apply!(rc, layer, props, props[e.prop.key]));
  ctx.restore();
}

function drawContent(rc: RenderContext, def: any, layer: Layer, props: Record<string, any>): void {
  const inst = rc.view.instance(layer.id);
  safe(rc.view, `layer:${layer.type}`, () => {
    if (inst?.draw) inst.draw(rc, props);
    else if (def.draw) def.draw(rc, layer, props);
  }, () => {
    const s = layerSize(rc.view, layer, props);
    drawMissing(rc.ctx, s.width, s.height, `${layer.type} (error)`);
  });
}

function safe(view: SceneView, source: string, fn: () => void, onError?: () => void): void {
  try {
    fn();
  } catch (err) {
    view.reportError?.(source, err);
    onError?.();
  }
}

export function drawMissing(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  ctx.save();
  ctx.fillStyle = 'rgba(200, 60, 90, 0.18)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 90, 120, 0.9)';
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb3c1';
  ctx.font = '14px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`⚠ ${label}`, 8, 8, Math.max(20, w - 16));
  ctx.restore();
}

export type { Canvas };
