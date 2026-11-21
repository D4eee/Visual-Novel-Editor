/**
 * Page-to-page inheritance.
 *
 * When the story moves from one page (scene) to the next, whatever is still running
 * on the old page continues on the new one:
 *   - media that keep playing (audio/video that autoplay and loop, or that a script starts and loop),
 *   - elements moved by looping animations that play automatically,
 *   - scripts that keep running (a "forever" loop, "every n seconds", "when the mouse enters")
 *     and the elements they use,
 *   - and everything the old page itself inherited.
 * Scripts on the old page decide otherwise with two blocks:
 *   - "When the page changes, remove ( )": the element (or, left empty, this script and its
 *     elements) does not continue;
 *   - "When the page changes, pause ( )": it continues paused — still listed on the next page,
 *     where "Resume ( )" starts it again.
 * The runtime applies these rules to what is actually running; the editor uses the same rules
 * to show, on each page, what it may inherit.
 */
import type { Block, Layer, Project, SceneData, ScriptStack, StoryNode, JumpData } from './types';
import type { Engine } from './registry';
import { isBlockRef } from './types';
import { jumpOutsFor } from './graph';

const GLOBAL_PAGE_ID = 'global';

export const LEAVE_REMOVE_BLOCK = 'core.onLeaveRemove';
export const LEAVE_PAUSE_BLOCK = 'core.onLeavePause';
const CONTINUOUS_HATS = new Set(['core.everySeconds', 'core.whenMouseInside']);
const START_BLOCKS = new Set(['core.startElement', 'core.playMedia']);

export interface InheritedElement {
  layer: Layer;
  /** The page the element was created on. */
  fromNodeId: string;
  paused: boolean;
  why: 'media' | 'animation' | 'script';
}

export interface InheritedScript {
  stack: ScriptStack;
  fromNodeId: string;
  paused: boolean;
}

export interface Inheritance {
  elements: InheritedElement[];
  scripts: InheritedScript[];
}

/** Audio played on the background-music channel (one track at a time). */
export function isMusic(l: Layer): boolean {
  return l.type === 'core.audio' && (l.props.category || 'bgm') === 'bgm' && l.props.persist !== false;
}

/** Visit a block tree (bodies and blocks nested in slots). */
export function walkBlocks(blocks: (Block | null | undefined)[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    if (!b) continue;
    fn(b);
    for (const v of Object.values(b.args || {})) if (isBlockRef(v)) walkBlocks([v.block], fn);
    if (b.body) walkBlocks(b.body, fn);
    if (b.else) walkBlocks(b.else, fn);
  }
}

/** Element ids a script uses (every `layer` argument). */
export function scriptElements(engine: Engine, s: ScriptStack): Set<string> {
  const out = new Set<string>();
  walkBlocks([s.hat, ...s.body], (b) => {
    const def = engine.blocks.get(b.type);
    for (const a of def?.args || []) if (a.type === 'layer' && typeof b.args[a.id] === 'string' && b.args[a.id]) out.add(b.args[a.id] as string);
  });
  return out;
}

/** Does this script keep running on its own (loop forever, timer or polling trigger)? */
export function isContinuousScript(s: ScriptStack): boolean {
  if (!s.enabled) return false;
  if (CONTINUOUS_HATS.has(s.hat?.type)) return true;
  let forever = false;
  walkBlocks(s.body, (b) => { if (b.type === 'core.forever') forever = true; });
  return forever;
}

/** What a page's scripts say should happen to elements and scripts when the page changes. */
export function leavePolicies(engine: Engine, scripts: ScriptStack[]): { removeLayers: Set<string>; pauseLayers: Set<string>; removeScripts: Set<string>; pauseScripts: Set<string> } {
  const r = { removeLayers: new Set<string>(), pauseLayers: new Set<string>(), removeScripts: new Set<string>(), pauseScripts: new Set<string>() };
  for (const s of scripts) {
    if (!s.enabled) continue;
    walkBlocks([s.hat, ...s.body], (b) => {
      if (b.type !== LEAVE_REMOVE_BLOCK && b.type !== LEAVE_PAUSE_BLOCK) return;
      const remove = b.type === LEAVE_REMOVE_BLOCK;
      const target = typeof b.args.layer === 'string' && b.args.layer ? (b.args.layer as string) : null;
      if (target) (remove ? r.removeLayers : r.pauseLayers).add(target);
      // Empty: this script. Its elements follow it (unless something else keeps them running).
      else (remove ? r.removeScripts : r.pauseScripts).add(s.id);
    });
  }
  // Removing wins over pausing.
  for (const id of r.removeLayers) r.pauseLayers.delete(id);
  for (const id of r.removeScripts) r.pauseScripts.delete(id);
  return r;
}

/** The pages the story can come from (through conditions, events, jumps…, not through other pages). */
export function previousPages(project: Project, nodeId: string): StoryNode<SceneData>[] {
  const out = new Map<string, StoryNode<SceneData>>();
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id) || depth > 40) return;
    seen.add(id);
    const n = project.nodes[id];
    if (n?.type === 'core.jumpIn') for (const o of jumpOutsFor(project, (n.data as JumpData).number)) walk(o.id, depth + 1);
    for (const e of project.edges) {
      if (e.to.node !== id) continue;
      const src = project.nodes[e.from.node];
      if (!src) continue;
      if (src.type === 'core.scene') out.set(src.id, src as StoryNode<SceneData>);
      else walk(src.id, depth + 1);
    }
  };
  walk(nodeId, 0);
  out.delete(nodeId);
  return [...out.values()];
}

/** What may still be running when a page ends (its own elements and scripts plus what it inherited). */
export function runningAtExit(engine: Engine, project: Project, nodeId: string, memo = new Map<string, Inheritance>(), stack = new Set<string>()): Inheritance {
  const node = project.nodes[nodeId];
  if (!node || node.type !== 'core.scene') return { elements: [], scripts: [] };
  const scene = node.data as SceneData;
  const inherited = inheritedInto(engine, project, nodeId, memo, stack);
  const policies = leavePolicies(engine, scene.scripts);
  const running = new Map<string, InheritedElement>();
  // Seen for several reasons: running wins over paused.
  const mark = (l: Layer, why: InheritedElement['why'], paused = false) => {
    const cur = running.get(l.id);
    if (!cur) running.set(l.id, { layer: l, fromNodeId: nodeId, paused, why });
    else if (cur.paused && !paused) running.set(l.id, { ...cur, paused: false, why });
  };
  const own = new Map(scene.layers.map((l) => [l.id, l]));
  // Media that keep playing.
  for (const l of scene.layers) {
    if ((l.type === 'core.audio' || l.type === 'core.video') && l.props.autoplay && l.props.loop && l.visible !== false) mark(l, 'media');
  }
  // Looping animations that start by themselves.
  for (const c of scene.animations) {
    if (!c.loop || !c.autoplay) continue;
    for (const t of c.tracks) { const l = own.get(t.layerId); if (l) mark(l, 'animation'); }
  }
  // Scripts that keep running, and looping media that scripts start.
  const scripts: InheritedScript[] = [];
  for (const s of scene.scripts) {
    if (!s.enabled) continue;
    walkBlocks(s.body, (b) => {
      if (!START_BLOCKS.has(b.type)) return;
      const l = own.get(b.args.layer as string);
      if (l && (l.type === 'core.audio' || l.type === 'core.video') && l.props.loop) mark(l, 'media');
    });
    if (!isContinuousScript(s) || policies.removeScripts.has(s.id)) continue;
    const paused = policies.pauseScripts.has(s.id);
    scripts.push({ stack: s, fromNodeId: nodeId, paused });
    for (const id of scriptElements(engine, s)) { const l = own.get(id); if (l) mark(l, 'script', paused); }
  }
  // Groups take their contents along.
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of scene.layers) {
      const parent = l.parentId ? running.get(l.parentId) : undefined;
      if (parent && !running.has(l.id)) { running.set(l.id, { layer: l, fromNodeId: nodeId, paused: parent.paused, why: parent.why }); grew = true; }
    }
  }
  // Inherited things continue unless this page removes them; this page can pause them.
  for (const e of inherited.elements) if (!own.has(e.layer.id) && !running.has(e.layer.id)) running.set(e.layer.id, { ...e });
  for (const s of inherited.scripts) if (!scripts.some((x) => x.stack.id === s.stack.id)) scripts.push({ ...s });
  const elements = [...running.values()]
    .filter((e) => !policies.removeLayers.has(e.layer.id))
    .map((e) => ({ ...e, paused: e.paused || policies.pauseLayers.has(e.layer.id) }));
  const keptScripts = scripts
    .filter((s) => !policies.removeScripts.has(s.stack.id))
    .map((s) => ({ ...s, paused: s.paused || policies.pauseScripts.has(s.stack.id) }));
  return { elements, scripts: keptScripts };
}

/** What a page may inherit from the pages before it (union over every way in). */
export function inheritedInto(engine: Engine, project: Project, nodeId: string, memo = new Map<string, Inheritance>(), stack = new Set<string>()): Inheritance {
  if (memo.has(nodeId)) return memo.get(nodeId)!;
  if (stack.has(nodeId)) return { elements: [], scripts: [] }; // a loop back to a page being computed
  stack.add(nodeId);
  const node = project.nodes[nodeId];
  const ownLayers = node && node.type === 'core.scene' ? (node.data as SceneData).layers : [];
  const own = new Set(ownLayers.map((l) => l.id));
  // Background music shares one channel: a page's own music replaces the music it would inherit.
  const ownMusic = ownLayers.some((l) => isMusic(l) && l.props.autoplay && l.visible !== false);
  const elements = new Map<string, InheritedElement>();
  const scripts = new Map<string, InheritedScript>();
  for (const prev of previousPages(project, nodeId)) {
    const r = runningAtExit(engine, project, prev.id, memo, stack);
    for (const e of r.elements) {
      if (own.has(e.layer.id)) continue; // coming back to the page that owns it
      if (ownMusic && isMusic(e.layer)) continue;
      const cur = elements.get(e.layer.id);
      // Seen through several ways in: running wins over paused.
      if (!cur || (cur.paused && !e.paused)) elements.set(e.layer.id, e);
    }
    for (const s of r.scripts) {
      if (s.fromNodeId === nodeId) continue;
      const cur = scripts.get(s.stack.id);
      if (!cur || (cur.paused && !s.paused)) scripts.set(s.stack.id, s);
    }
  }
  stack.delete(nodeId);
  const result = { elements: [...elements.values()], scripts: [...scripts.values()] };
  memo.set(nodeId, result);
  return result;
}

/** What a page shows besides its own elements: inherited ones and the global page's. */
export interface PageContext {
  isGlobal: boolean;
  inherited: InheritedElement[];
  inheritedScripts: InheritedScript[];
  /** Global elements behind / in front of the page's own. */
  globalBack: Layer[];
  globalFront: Layer[];
}

export function pageContext(engine: Engine, project: Project, nodeId: string, memo = new Map<string, Inheritance>()): PageContext {
  const g = project.nodes[GLOBAL_PAGE_ID];
  const gl = g && g.id !== nodeId ? ((g.data as SceneData).layers || []) : [];
  const isGlobal = nodeId === GLOBAL_PAGE_ID;
  const inh = isGlobal ? { elements: [], scripts: [] } : inheritedInto(engine, project, nodeId, memo);
  // Children follow their group's zone.
  const zoneOf = (l: Layer): string | undefined => {
    let cur = l;
    const seen = new Set<string>();
    while (cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = gl.find((x) => x.id === cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur.zone;
  };
  return {
    isGlobal,
    inherited: inh.elements,
    inheritedScripts: inh.scripts,
    globalBack: gl.filter((l) => zoneOf(l) === 'back'),
    globalFront: gl.filter((l) => zoneOf(l) !== 'back'),
  };
}
