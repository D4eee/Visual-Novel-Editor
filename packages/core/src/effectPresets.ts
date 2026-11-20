/**
 * Effect presets: an element's effect saved under a name, so it can be applied
 * to other elements and in other projects. A preset is a self-contained copy of
 * the effect graph (`.vnefx` file, JSON); applying it puts a fresh copy on the
 * element, so projects never depend on the preset file.
 */
import type { EffectGraph, LayerEffect, Project } from './types';
import { newId } from './util';

export const EFFECT_PRESET_FORMAT = 'vne.effect-preset';
export const EFFECT_PRESET_VERSION = 1;
export const EFFECT_PRESET_EXT = 'vnefx';

export interface EffectPreset {
  format: typeof EFFECT_PRESET_FORMAT;
  version: number;
  id: string;
  name: string;
  description?: string;
  /** ISO time of the last save. */
  savedAt: string;
  /** The effect, with the element's current parameter values as defaults. */
  graph: EffectGraph;
  /** Modules whose effect nodes the graph uses (node types `<moduleId>/<name>`). */
  requires: string[];
}

/** The graph an element's effect uses (inline, or the shared graph it links to). */
export function effectGraphOf(project: Project, effect: LayerEffect | null | undefined): EffectGraph | null {
  if (!effect) return null;
  if (effect.kind === 'inline') return effect.graph;
  return project.effectGraphs.find((g) => g.id === effect.graphId) || null;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Module ids used by a graph's nodes. */
export function graphModules(graph: EffectGraph): string[] {
  return [...new Set(graph.nodes.filter((n) => n.type.includes('/')).map((n) => n.type.slice(0, n.type.lastIndexOf('/'))))].sort();
}

/** Make a preset from an element's effect. For a linked effect, the element's parameter values become the defaults. */
export function presetFromEffect(project: Project, effect: LayerEffect, name: string, description?: string): EffectPreset {
  const src = effectGraphOf(project, effect);
  if (!src) throw new Error('The element has no effect');
  const graph = clone(src);
  graph.name = name;
  if (effect.kind === 'ref') {
    for (const p of graph.params) if (p.id in effect.params) p.default = effect.params[p.id];
  }
  return {
    format: EFFECT_PRESET_FORMAT,
    version: EFFECT_PRESET_VERSION,
    id: newId('fxp'),
    name,
    ...(description ? { description } : {}),
    savedAt: new Date().toISOString(),
    graph,
    requires: graphModules(graph),
  };
}

/**
 * A new inline effect from a preset. Node, edge and graph ids are fresh, so the
 * same preset can be applied many times; parameter ids are kept, so timeline
 * tracks of effect parameters (`fx.<param>`) keep working when a preset replaces an effect.
 */
export function effectFromPreset(preset: EffectPreset): LayerEffect {
  const g = clone(preset.graph);
  const ids = new Map<string, string>();
  for (const n of g.nodes) { const id = newId('fxn'); ids.set(n.id, id); n.id = id; }
  for (const e of g.edges) {
    e.id = newId('fxe');
    e.from = { ...e.from, node: ids.get(e.from.node) || e.from.node };
    e.to = { ...e.to, node: ids.get(e.to.node) || e.to.node };
  }
  g.id = newId('fxg');
  g.name = preset.name;
  return { kind: 'inline', graph: g };
}

/** Check and normalise a preset read from a file. Throws a readable error when it is not a preset. */
export function parseEffectPreset(input: string | unknown): EffectPreset {
  let v: any = input;
  if (typeof input === 'string') {
    try { v = JSON.parse(input); } catch { throw new Error('Not a JSON file'); }
  }
  if (!v || typeof v !== 'object' || v.format !== EFFECT_PRESET_FORMAT) throw new Error('Not an effect preset');
  if (typeof v.version !== 'number' || v.version > EFFECT_PRESET_VERSION) throw new Error(`Effect preset version ${v.version} is newer than this editor supports`);
  const g = v.graph;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('The preset has no effect graph');
  const nodeIds = new Set<string>();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== 'string' || typeof n.type !== 'string') throw new Error('The preset has an invalid node');
    nodeIds.add(n.id);
    n.x = Number(n.x) || 0; n.y = Number(n.y) || 0; n.values = n.values && typeof n.values === 'object' ? n.values : {};
  }
  g.edges = g.edges.filter((e: any) => e && e.from && e.to && nodeIds.has(e.from.node) && nodeIds.has(e.to.node));
  g.params = Array.isArray(g.params) ? g.params.filter((p: any) => p && typeof p.id === 'string') : [];
  g.id = typeof g.id === 'string' ? g.id : newId('fxg');
  const name = String(v.name || g.name || 'Preset').slice(0, 120);
  g.name = typeof g.name === 'string' ? g.name : name;
  return {
    format: EFFECT_PRESET_FORMAT,
    version: EFFECT_PRESET_VERSION,
    id: typeof v.id === 'string' && /^[\w-]{1,64}$/.test(v.id) ? v.id : newId('fxp'),
    name,
    ...(typeof v.description === 'string' && v.description ? { description: v.description.slice(0, 500) } : {}),
    savedAt: typeof v.savedAt === 'string' ? v.savedAt : new Date().toISOString(),
    graph: g,
    requires: graphModules(g),
  };
}

/** What applying a preset in a project may need attention for. */
export function presetWarnings(project: Project, preset: EffectPreset, hasNodeType: (type: string) => boolean, sceneLayerIds?: Iterable<string>): { missingModules: string[]; unknownNodes: string[]; missingVariables: boolean; missingLayers: boolean } {
  const unknownNodes = [...new Set(preset.graph.nodes.map((n) => n.type).filter((t) => !hasNodeType(t)))];
  const missingModules = preset.requires.filter((m) => unknownNodes.some((t) => t.startsWith(`${m}/`)));
  const vars = new Set(project.variables.map((v) => v.id));
  const missingVariables = preset.graph.nodes.some((n) => n.type === 'fx.variable' && n.values?.variable && !vars.has(n.values.variable));
  const layers = sceneLayerIds ? new Set(sceneLayerIds) : null;
  const missingLayers = !!layers && preset.graph.nodes.some((n) => n.type === 'fx.layerProp' && n.values?.layer && !layers.has(n.values.layer));
  return { missingModules, unknownNodes: unknownNodes.filter((t) => !missingModules.some((m) => t.startsWith(`${m}/`))), missingVariables, missingLayers };
}
