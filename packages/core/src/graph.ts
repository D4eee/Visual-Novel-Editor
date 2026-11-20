import type { Engine, PortDef } from './registry';
import type { Project, SceneData, StoryEdge, StoryNode, Id, JumpData } from './types';
import { sceneChoices, choiceLayers } from './elements';
import { newId, remapIds } from './util';

export const SCENE_DEFAULT_PORT = 'next';
export const choicePort = (choiceId: string) => `c:${choiceId}`;

export interface NodePorts {
  inputs: PortDef[];
  outputs: PortDef[];
  unknown: boolean;
}

/** Ports for a node. Unknown node types (missing module) expose ports inferred from saved edges so nothing is lost. */
export function nodePorts(engine: Engine, project: Project, node: StoryNode): NodePorts {
  const def = engine.nodeTypes.get(node.type);
  if (def) {
    try {
      return { inputs: def.inputs(node, project), outputs: def.outputs(node, project), unknown: false };
    } catch (err) {
      console.error(`[vne] ports for ${node.type} failed`, err);
    }
  }
  const ins = new Map<string, PortDef>();
  const outs = new Map<string, PortDef>();
  for (const e of project.edges) {
    if (e.to.node === node.id) ins.set(e.to.port, { id: e.to.port, type: 'flow', multiple: true });
    if (e.from.node === node.id) outs.set(e.from.port, { id: e.from.port, type: 'flow' });
  }
  return { inputs: [...ins.values()], outputs: [...outs.values()], unknown: true };
}

export function portType(engine: Engine, typeId: string) {
  return engine.portTypes.get(typeId);
}

export function isFlowPort(engine: Engine, p: PortDef): boolean {
  const t = engine.portTypes.get(p.type);
  return !t || t.kind === 'flow';
}

export function typesCompatible(engine: Engine, outType: string, inType: string): boolean {
  if (outType === inType) return true;
  const inDef = engine.portTypes.get(inType);
  if (inDef?.accepts?.includes(outType) || inDef?.accepts?.includes('*')) return true;
  return false;
}

export type ConnectCheck = { ok: true } | { ok: false; reason: string };

export function canConnect(engine: Engine, project: Project, from: { node: Id; port: string }, to: { node: Id; port: string }): ConnectCheck {
  const a = project.nodes[from.node];
  const b = project.nodes[to.node];
  if (!a || !b) return { ok: false, reason: 'graph.err.missingNode' };
  const outP = nodePorts(engine, project, a).outputs.find((p) => p.id === from.port);
  const inP = nodePorts(engine, project, b).inputs.find((p) => p.id === to.port);
  if (!outP || !inP) return { ok: false, reason: 'graph.err.missingPort' };
  if (!typesCompatible(engine, outP.type, inP.type)) return { ok: false, reason: 'graph.err.typeMismatch' };
  if (a.id === b.id && !isFlowPort(engine, outP)) return { ok: false, reason: 'graph.err.selfData' };
  return { ok: true };
}

/**
 * Connect two ports on a draft project. Flow outputs and data inputs accept a single
 * connection, so an existing connection is replaced. Returns the new edge id.
 */
export function connect(engine: Engine, draft: Project, from: { node: Id; port: string }, to: { node: Id; port: string }): string | null {
  const check = canConnect(engine, draft, from, to);
  if (!check.ok) return null;
  const outP = nodePorts(engine, draft, draft.nodes[from.node]).outputs.find((p) => p.id === from.port)!;
  const inP = nodePorts(engine, draft, draft.nodes[to.node]).inputs.find((p) => p.id === to.port)!;
  const flow = isFlowPort(engine, outP);
  const replaceOutgoing = flow; // a flow output goes to exactly one place
  const inMultiple = inP.multiple ?? flow;
  draft.edges = draft.edges.filter((e) => {
    if (replaceOutgoing && e.from.node === from.node && e.from.port === from.port) return false;
    if (!inMultiple && e.to.node === to.node && e.to.port === to.port) return false;
    if (e.from.node === from.node && e.from.port === from.port && e.to.node === to.node && e.to.port === to.port) return false;
    return true;
  });
  const id = newId('edg');
  draft.edges.push({ id, from: { ...from }, to: { ...to } });
  return id;
}

export function disconnectPort(draft: Project, nodeId: Id, portId: string, side: 'in' | 'out'): void {
  draft.edges = draft.edges.filter((e) => (side === 'out' ? !(e.from.node === nodeId && e.from.port === portId) : !(e.to.node === nodeId && e.to.port === portId)));
}

export function deleteNodes(draft: Project, ids: Iterable<Id>): void {
  const set = new Set(ids);
  for (const id of set) delete draft.nodes[id];
  draft.edges = draft.edges.filter((e) => !set.has(e.from.node) && !set.has(e.to.node));
  for (const ch of draft.chapters) if (ch.entryNodeId && set.has(ch.entryNodeId)) ch.entryNodeId = null;
}

export interface Clip {
  kind: 'vne.nodes';
  nodes: StoryNode[];
  edges: StoryEdge[];
}

export function copyNodes(project: Project, ids: Iterable<Id>): Clip {
  const set = new Set(ids);
  const nodes = [...set].map((id) => project.nodes[id]).filter(Boolean).filter((n) => n.type !== 'core.start');
  const keep = new Set(nodes.map((n) => n.id));
  const edges = project.edges.filter((e) => keep.has(e.from.node) && keep.has(e.to.node));
  return JSON.parse(JSON.stringify({ kind: 'vne.nodes', nodes, edges }));
}

/** Paste a clip into a chapter with fresh ids everywhere (nodes, layers, choices...). Choice ports are remapped too. */
export function pasteNodes(draft: Project, clip: Clip, chapterId: Id, offset: { x: number; y: number }): Id[] {
  // Remap every id-like value inside the clip, including choice ids used in port names.
  const { value, map } = remapIds({ nodes: clip.nodes, edges: clip.edges });
  const portMap = (p: string) => (p.startsWith('c:') && map.has(p.slice(2)) ? `c:${map.get(p.slice(2))}` : p);
  const created: Id[] = [];
  for (const n of value.nodes) {
    n.chapterId = chapterId;
    n.x += offset.x;
    n.y += offset.y;
    draft.nodes[n.id] = n;
    created.push(n.id);
  }
  for (const e of value.edges) {
    draft.edges.push({ id: e.id, from: { node: e.from.node, port: portMap(e.from.port) }, to: { node: e.to.node, port: portMap(e.to.port) } });
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Scene choices ⇄ graph output ports                                   */
/* ------------------------------------------------------------------ */

export function scenePorts(data: SceneData): PortDef[] {
  const choices = sceneChoices(data);
  if (!choices.length) return [{ id: SCENE_DEFAULT_PORT, type: 'flow', label: 'port.next' }];
  return choices.map((c) => ({ id: choicePort(c.id), type: 'flow', label: c.text }));
}

/** Ids of the choice elements of a scene, in port order. */
export function sceneChoiceIds(project: Project, nodeId: Id): string[] {
  const n = project.nodes[nodeId];
  return n && n.type === 'core.scene' ? choiceLayers(n.data as SceneData).map((l) => l.id) : [];
}

/**
 * Call after a scene's choice elements changed (inside the same draft update), with
 * the choice ids from before the change. Keeps connections:
 * - choices keep their edges because ports use stable ids, regardless of text, order or position;
 * - adding the first choice moves the default "next" connection onto it;
 * - removing the last choice moves its connection back to "next";
 * - edges of deleted choices are removed.
 */
export function syncSceneChoiceEdges(draft: Project, nodeId: Id, before: string[]): void {
  const node = draft.nodes[nodeId];
  if (!node) return;
  const after = choiceLayers(node.data as SceneData).map((l) => l.id);
  const outgoing = draft.edges.filter((e) => e.from.node === nodeId);
  if (before.length === 0 && after.length > 0) {
    for (const e of outgoing) if (e.from.port === SCENE_DEFAULT_PORT) e.from.port = choicePort(after[0]);
  } else if (before.length > 0 && after.length === 0) {
    const survivorId = outgoing.find((e) => e.from.port.startsWith('c:'))?.id;
    draft.edges = draft.edges.filter((e) => !(e.from.node === nodeId && e.from.port.startsWith('c:') && e.id !== survivorId));
    const s = draft.edges.find((e) => e.id === survivorId);
    if (s) s.from.port = SCENE_DEFAULT_PORT;
    return;
  }
  const valid = new Set(after.map((id) => choicePort(id)));
  if (after.length === 0) valid.add(SCENE_DEFAULT_PORT);
  draft.edges = draft.edges.filter((e) => e.from.node !== nodeId || valid.has(e.from.port));
}

/** Remove edges that reference nodes or ports that no longer exist (known node types only). */
export function pruneEdges(engine: Engine, draft: Project): number {
  const before = draft.edges.length;
  draft.edges = draft.edges.filter((e) => {
    const a = draft.nodes[e.from.node];
    const b = draft.nodes[e.to.node];
    if (!a || !b) return false;
    if (!engine.nodeTypes.has(a.type) || !engine.nodeTypes.has(b.type)) return true; // keep unknown data
    return nodePorts(engine, draft, a).outputs.some((p) => p.id === e.from.port) && nodePorts(engine, draft, b).inputs.some((p) => p.id === e.to.port);
  });
  return before - draft.edges.length;
}

/* ------------------------------------------------------------------ */
/* Navigation helpers                                                    */
/* ------------------------------------------------------------------ */

export function startNode(project: Project): StoryNode | undefined {
  return Object.values(project.nodes).find((n) => n.type === 'core.start');
}

export function outgoing(project: Project, nodeId: Id, port?: string): StoryEdge[] {
  return project.edges.filter((e) => e.from.node === nodeId && (port === undefined || e.from.port === port));
}

export function incoming(project: Project, nodeId: Id): StoryEdge[] {
  return project.edges.filter((e) => e.to.node === nodeId);
}

export function jumpOutsFor(project: Project, number: number): StoryNode[] {
  return Object.values(project.nodes).filter((n) => n.type === 'core.jumpOut' && (n.data as JumpData).number === number);
}

export function jumpInsFor(project: Project, number: number): StoryNode[] {
  return Object.values(project.nodes).filter((n) => n.type === 'core.jumpIn' && (n.data as JumpData).number === number);
}

export function nextJumpNumber(project: Project): number {
  let max = 0;
  for (const n of Object.values(project.nodes)) if (n.type === 'core.jumpIn' || n.type === 'core.jumpOut') max = Math.max(max, (n.data as JumpData).number || 0);
  return max + 1;
}

export function nodesInChapter(project: Project, chapterId: Id): StoryNode[] {
  return Object.values(project.nodes).filter((n) => n.chapterId === chapterId);
}

/**
 * Entry node of a chapter for "preview from chapter start":
 * explicit entry → node targeted by Start → node entered from another chapter or via Jump Out → first scene by number.
 */
export function chapterEntry(project: Project, chapterId: Id): StoryNode | undefined {
  const ch = project.chapters.find((c) => c.id === chapterId);
  if (ch?.entryNodeId && project.nodes[ch.entryNodeId]) return project.nodes[ch.entryNodeId];
  const nodes = nodesInChapter(project, chapterId);
  const ids = new Set(nodes.map((n) => n.id));
  const start = nodes.find((n) => n.type === 'core.start');
  if (start) return start;
  const fromOutside = project.edges.find((e) => ids.has(e.to.node) && !ids.has(e.from.node));
  if (fromOutside) return project.nodes[fromOutside.to.node];
  const jumpOut = nodes.find((n) => n.type === 'core.jumpOut');
  if (jumpOut) return jumpOut;
  const scenes = nodes.filter((n) => n.type === 'core.scene').sort((a, b) => sceneNumberValue(a) - sceneNumberValue(b) || a.x - b.x);
  return scenes[0] || nodes.sort((a, b) => a.x - b.x)[0];
}

function sceneNumberValue(n: StoryNode): number {
  const v = parseFloat((n.data as SceneData).number);
  return Number.isFinite(v) ? v : 1e9;
}

/** Breadth-first reachability from Start, following edges and jump pairs. */
export function reachableFrom(project: Project, startId: Id): Set<Id> {
  const seen = new Set<Id>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    const n = project.nodes[id];
    if (!n) continue;
    const next: Id[] = outgoing(project, id).map((e) => e.to.node);
    if (n.type === 'core.jumpIn') next.push(...jumpOutsFor(project, (n.data as JumpData).number).map((j) => j.id));
    for (const m of next) if (!seen.has(m)) { seen.add(m); queue.push(m); }
  }
  return seen;
}

export function moveNodesToChapter(draft: Project, ids: Id[], chapterId: Id): void {
  for (const id of ids) if (draft.nodes[id]) draft.nodes[id].chapterId = chapterId;
}
