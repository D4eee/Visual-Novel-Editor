import type { Id, Project, SceneData, StoryNode } from './types';

export interface RefLocation {
  nodeId?: Id;
  /** Human-readable path inside the node data, e.g. "layers[2].props.assetId". */
  path: string;
  layerId?: Id;
  where: 'node' | 'settings' | 'character' | 'composition' | 'extension' | 'effectGraph' | 'behavior';
}

/**
 * Find every place an id is referenced. Ids are random and prefixed, so a deep scan
 * of the JSON is both exact and future-proof: module data that stores asset or
 * variable ids is found without the module having to declare anything.
 */
export function findReferences(project: Project, ids: Set<string>): Map<string, RefLocation[]> {
  const out = new Map<string, RefLocation[]>();
  const add = (id: string, loc: RefLocation) => {
    let arr = out.get(id);
    if (!arr) out.set(id, (arr = []));
    arr.push(loc);
  };
  const walk = (v: any, path: string, base: Omit<RefLocation, 'path'>, layerId?: Id) => {
    if (typeof v === 'string') {
      if (ids.has(v)) add(v, { ...base, path, layerId });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, base, layerId));
      return;
    }
    if (v && typeof v === 'object') {
      const lid = typeof v.id === 'string' && v.id.startsWith('lyr_') ? v.id : layerId;
      for (const k of Object.keys(v)) {
        if (k === 'id') continue; // an entity's own id is not a reference
        walk(v[k], path ? `${path}.${k}` : k, base, lid);
      }
    }
  };
  for (const n of Object.values(project.nodes)) {
    walk(n.data, 'data', { where: 'node', nodeId: n.id });
    walk(n.modules, 'modules', { where: 'node', nodeId: n.id });
  }
  walk(project.settings, 'settings', { where: 'settings' });
  walk(project.characters, 'characters', { where: 'character' });
  walk(project.compositions, 'compositions', { where: 'composition' });
  walk(project.effectGraphs, 'effectGraphs', { where: 'effectGraph' });
  walk(project.behaviors, 'behaviors', { where: 'behavior' });
  walk(project.extensions, 'extensions', { where: 'extension' });
  return out;
}

export function assetUsage(project: Project): Map<string, RefLocation[]> {
  return findReferences(project, new Set(project.assets.map((a) => a.id)));
}

export function variableUsage(project: Project): Map<string, RefLocation[]> {
  return findReferences(project, new Set(project.variables.map((v) => v.id)));
}

/** Asset ids needed to play the game (for export: only copy what is used). */
export function usedAssetIds(project: Project): Set<string> {
  const usage = assetUsage(project);
  return new Set([...usage.keys()]);
}

export function sceneOf(node: StoryNode | undefined): SceneData | null {
  return node && node.type === 'core.scene' ? (node.data as SceneData) : null;
}

/** Collect module ids a project actually uses through node types, layers, blocks, components and effects. */
export function usedTypeIds(project: Project): { nodeTypes: Set<string>; layerTypes: Set<string>; blocks: Set<string>; components: Set<string>; effectNodes: Set<string>; transitions: Set<string>; interpolators: Set<string> } {
  const r = { nodeTypes: new Set<string>(), layerTypes: new Set<string>(), blocks: new Set<string>(), components: new Set<string>(), effectNodes: new Set<string>(), transitions: new Set<string>(), interpolators: new Set<string>() };
  const blocks = (list: any[] | undefined) => {
    for (const b of list || []) {
      if (!b) continue;
      r.blocks.add(b.type);
      blocks(b.body);
      blocks(b.else);
    }
  };
  const graph = (g: any) => { for (const n of g?.nodes || []) r.effectNodes.add(n.type); };
  const layers = (ls: any[]) => {
    for (const l of ls || []) {
      r.layerTypes.add(l.type);
      if (l.effect?.kind === 'inline') graph(l.effect.graph);
    }
  };
  for (const n of Object.values(project.nodes)) {
    r.nodeTypes.add(n.type);
    for (const m of n.modules || []) r.components.add(m.component);
    const d: any = n.data;
    if (n.type === 'core.scene') {
      layers(d.layers);
      for (const s of d.scripts || []) { blocks([s.hat]); blocks(s.body); }
      for (const a of d.animations || []) for (const t of a.tracks || []) for (const k of t.keyframes || []) r.interpolators.add(k.ease);
      if (d.transition?.type) r.transitions.add(d.transition.type);
    }
    if (d && Array.isArray(d.actions)) blocks(d.actions);
  }
  for (const c of project.compositions) layers(c.layers);
  for (const g of project.effectGraphs) graph(g);
  for (const b of project.behaviors) blocks(b.body);
  if (project.settings.defaultTransition?.type) r.transitions.add(project.settings.defaultTransition.type);
  return r;
}
