import type { Block, Issue, Layer, Project, StoryNode, VarValue, VarType } from './types';
import type { ExprFunction } from './expr';
import { Emitter } from './util';

/**
 * Engine registries. Built-in features are registered through exactly the same
 * interfaces that community modules use, so every extension point is exercised
 * by the engine itself.
 *
 * Runtime context types are intentionally loose here (`any`) because the core
 * package has no DOM dependency; the precise types live in the runtime package
 * and in the public SDK typings.
 */

export interface Registrable {
  id: string;
  /** Module that registered the entry ("core" for built-ins). Filled in by the registry. */
  owner?: string;
}

export class Registry<T extends Registrable> {
  private items = new Map<string, T>();
  private events = new Emitter<{ change: { id: string; kind: 'add' | 'remove' } }>();

  constructor(readonly kind: string) {}

  register(def: T, owner = 'core'): () => void {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error(`[${this.kind}] definition needs a string id`);
    if (this.items.has(def.id) && this.items.get(def.id)!.owner !== owner) {
      throw new Error(`[${this.kind}] "${def.id}" is already registered by ${this.items.get(def.id)!.owner}`);
    }
    const entry = { ...def, owner };
    this.items.set(def.id, entry);
    this.events.emit('change', { id: def.id, kind: 'add' });
    return () => this.unregister(def.id);
  }

  unregister(id: string): void {
    if (this.items.delete(id)) this.events.emit('change', { id, kind: 'remove' });
  }

  unregisterOwner(owner: string): void {
    for (const [id, item] of [...this.items]) if (item.owner === owner) this.unregister(id);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  list(): T[] {
    return [...this.items.values()];
  }

  onChange(fn: (e: { id: string; kind: 'add' | 'remove' }) => void): () => void {
    return this.events.on('change', fn);
  }
}

/* ------------------------------------------------------------------ */
/* Property schema (used for inspectors, animation and module config)  */
/* ------------------------------------------------------------------ */

export type PropType =
  | 'number' | 'string' | 'text' | 'boolean' | 'color' | 'select'
  | 'asset' | 'character' | 'portrait' | 'variable' | 'layer' | 'animation'
  | 'choice' | 'node' | 'font' | 'vector' | 'json' | 'expr' | 'item' | 'composition' | 'motion' | 'expression';

export interface PropDef {
  key: string;
  /**
   * Shown to players as text, so it goes into the translation table (API 1.4). Long `text`
   * properties and `string` properties named `text` are translatable without this.
   */
  translatable?: boolean;
  /**
   * A value that starts something when it changes (e.g. a character's motion): animation
   * sampling also reports how long ago it was keyed, as `<key>Since` (API 1.6).
   */
  clock?: boolean;
  type: PropType;
  /** Label: plain text or an i18n key. */
  label: string;
  default?: any;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string | number; label: string }[];
  assetKind?: 'image' | 'audio' | 'video' | 'font';
  animatable?: boolean;
  group?: string;
  description?: string;
  /** Hide in the inspector (still serialised). */
  hidden?: boolean;
}

/* ------------------------------------------------------------------ */
/* Story graph                                                          */
/* ------------------------------------------------------------------ */

export interface PortTypeDef extends Registrable {
  label: string;
  color: string;
  /** Other port types this input accepts. Same type is always accepted. */
  accepts?: string[];
  /** Flow ports carry execution. Data ports carry values that are pulled when needed. */
  kind: 'flow' | 'data';
}

export interface PortDef {
  id: string;
  label?: string;
  type: string;
  /** Inputs: allow more than one connection. Flow inputs default to true, data inputs to false. */
  multiple?: boolean;
}

export type NodeRunResult = string | null | { goto: string } | { end: true };

export interface NodeTypeDef extends Registrable {
  label: string;
  category: 'flow' | 'scene' | 'logic' | 'organize' | 'module';
  color: string;
  icon?: string;
  description?: string;
  /** Show in the node creation menu. */
  creatable?: boolean;
  /** At most one per project (e.g. Start). */
  unique?: boolean;
  createData(project: Project): any;
  inputs(node: StoryNode, project: Project): PortDef[];
  outputs(node: StoryNode, project: Project): PortDef[];
  /** Short text shown inside the node in the graph. */
  summary?(node: StoryNode, project: Project, t: (k: string, p?: any) => string): string;
  /** Which detailed workspace double-click opens: "scene", "logic" or a custom workspace id. */
  workspace?: string;
  /** Runtime: execute the node and return the output port to follow. */
  run?(node: StoryNode, ctx: any): NodeRunResult | Promise<NodeRunResult>;
  /** Runtime: compute a data output (for data ports). */
  evaluate?(node: StoryNode, port: string, ctx: any): VarValue | Promise<VarValue>;
  validate?(node: StoryNode, project: Project): Issue[];
  /** Property schema for a generated inspector (module-defined nodes). */
  props?: PropDef[];
}

/* ------------------------------------------------------------------ */
/* Layers                                                               */
/* ------------------------------------------------------------------ */

export interface LayerTypeDef extends Registrable {
  label: string;
  icon?: string;
  category: 'media' | 'text' | 'ui' | 'interactive' | 'effect' | 'structure' | 'module';
  /** Non-visual layers (audio) are not drawn on the canvas. */
  visual: boolean;
  props: PropDef[];
  /** Default property values for a new layer. Transform defaults are added automatically for visual layers. */
  defaults?(ctx: { project: Project; width: number; height: number }): Record<string, any>;
  /** Intrinsic size used for hit-testing, gizmos and effects. */
  size?(layer: Layer, props: Record<string, any>, rc: any): { width: number; height: number };
  /** Draw into a 2D context whose origin is the layer's top-left corner. */
  draw?(rc: any, layer: Layer, props: Record<string, any>): void;
  /** Create a per-scene runtime instance (media elements, particle state...). */
  createInstance?(layer: Layer, rt: any): LayerInstance;
  /**
   * Precise hit test in the layer's local coordinates (0..width, 0..height), for
   * clicks, hover and the "mouse inside" block. Default: the layer's rectangle.
   */
  hitTest?(layer: Layer, props: Record<string, any>, x: number, y: number, size: { width: number; height: number }): boolean;
  /**
   * Advance the element's live state each frame while the game plays (sprites step their
   * frames this way). `state` is the element's current property values; change it in place.
   */
  step?(state: Record<string, any>, dt: number, ctx: { layer: Layer; emit(e: { type: string; [k: string]: any }): void; runtime: any }): void;
  /**
   * A click on the element while the game plays, in local coordinates. Return true when the
   * element handled it (the inventory selects the item under the pointer this way).
   */
  pointer?(layer: Layer, props: Record<string, any>, x: number, y: number, size: { width: number; height: number }, ctx: { emit(e: { type: string; [k: string]: any }): void; runtime: any }): boolean;
  /** Always receives clicks (even when no script listens to it). */
  interactive?: boolean;
}

export interface LayerInstance {
  update?(dt: number, props: Record<string, any>, time: number): void;
  draw?(rc: any, props: Record<string, any>): void;
  play?(offset?: number): void;
  pause?(): void;
  stop?(): void;
  seek?(seconds: number): void;
  dispose?(): void;
  [k: string]: any;
}

/** Adds a property to existing layer types (e.g. a module-defined animatable "glow"). */
export interface PropertyExtensionDef extends Registrable {
  layerTypes: string[] | '*';
  prop: PropDef;
  /** Optional draw hook applied after the layer is drawn (or before with `phase: "before"`). */
  apply?(rc: any, layer: Layer, props: Record<string, any>, value: any): void;
  phase?: 'before' | 'after' | 'transform';
}

export interface InterpolatorDef extends Registrable {
  label: string;
  /** Map linear progress 0..1 to eased progress. `k` is the keyframe that starts the segment. */
  ease(t: number, k?: any): number;
  /** Discrete interpolators hold the start value until the next keyframe. */
  discrete?: boolean;
}

/* ------------------------------------------------------------------ */
/* Visual scripting                                                     */
/* ------------------------------------------------------------------ */

/**
 * hat: starts a script; statement/c/c-else/cap: steps of a script;
 * reporter (round) and boolean (pointed): values that go into other blocks' slots.
 */
export type BlockShape = 'hat' | 'statement' | 'c' | 'c-else' | 'cap' | 'reporter' | 'boolean';
export type BlockCategory = 'elements' | 'events' | 'control' | 'looks' | 'sound' | 'sensing' | 'variables' | 'story' | 'operators' | 'game' | 'module';

export interface BlockArgDef {
  id: string;
  /** `string` / literal `expr` arguments shown to players (API 1.4): they go into the translation table. */
  translatable?: boolean;
  type: 'number' | 'string' | 'boolean' | 'layer' | 'animation' | 'variable' | 'asset' | 'choice' | 'line'
    | 'key' | 'select' | 'expr' | 'port' | 'node' | 'character' | 'portrait' | 'behavior' | 'prop' | 'ease' | 'message'
    | 'item' | 'param' | 'motion' | 'expression';
  default?: any;
  options?: { value: string | number; label: string }[];
  assetKind?: 'image' | 'audio' | 'video';
  /** `layer` arguments: element types this slot accepts (default: any element). */
  layerTypes?: string[];
  /** `variable` arguments: only variables of this type (e.g. 'list'). */
  varType?: VarType;
  /** `param` arguments: the id of the `layer` argument whose parameters are listed. */
  paramOf?: string;
  /** Text and number arguments may be left empty (shown as a hint, passed as null). */
  optional?: boolean;
}

export interface BlockDef extends Registrable {
  category: BlockCategory | string;
  shape: BlockShape;
  /** Label template, e.g. "play {anim} and wait {wait}" — i18n key or literal. */
  label: string;
  args: BlockArgDef[];
  color?: string;
  /** Where the block may be used. Default: both. */
  context?: 'scene' | 'story' | 'both';
  /**
   * Nothing can follow this block (it never finishes, like "forever"). `cap` blocks end
   * a script anyway; set this on a `c` block to draw it without a bottom connector.
   */
  endsScript?: boolean;
  /** Statement execution. May return a promise to wait. */
  run?(ctx: any, args: Record<string, any>, block: Block): void | Promise<void>;
  /** Reporter / boolean blocks: compute the value (synchronously). */
  report?(ctx: any, args: Record<string, any>, block: Block): any;
  /**
   * Blocks with an element (`layer`) argument are offered under each element in the
   * Interactions palette, pre-filled with it. `layerTypes` limits that to these
   * element types (e.g. media blocks: core.audio, core.video); without it, every
   * visible element gets the block. Module layer types get their blocks this way.
   */
  layerTypes?: string[];
  /** Hats: return true when the runtime event matches this hat's arguments. */
  matches?(event: { type: string; [k: string]: any }, args: Record<string, any>): boolean;
  /** Hat event type (e.g. "layer.click"). */
  event?: string;
  /**
   * Hats that trigger themselves (timers, polling): called when the scene starts with a `fire`
   * callback that runs the stack. Return a cleanup function.
   */
  setup?(ctx: any, args: Record<string, any>, fire: () => void): (() => void) | void;
}

/* ------------------------------------------------------------------ */
/* Procedural effects                                                   */
/* ------------------------------------------------------------------ */

export interface EffectPortDef {
  id: string;
  label: string;
  type: 'image' | 'number' | 'color' | 'boolean' | 'select' | 'string' | 'layer' | 'prop' | 'variable';
  default?: any;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  /** Value-only inputs are edited inline and cannot be connected. */
  inlineOnly?: boolean;
}

export interface EffectNodeDef extends Registrable {
  label: string;
  category: 'input' | 'output' | 'color' | 'filter' | 'distort' | 'generate' | 'composite' | 'math' | 'value' | 'drive' | 'module';
  inputs: EffectPortDef[];
  outputs: EffectPortDef[];
  /** Evaluate the node. Image values are canvases (or canvas-like); numbers are numbers. */
  evaluate(ctx: any, inputs: Record<string, any>, node: any): Record<string, any>;
  /** True if the result depends on time and must be recomputed every frame. */
  animated?: boolean;
}

export interface TransitionDef extends Registrable {
  label: string;
  params?: PropDef[];
  /** Draw a frame of the transition. `from`/`to` are canvases; progress 0..1. */
  draw(ctx: any, from: any, to: any, progress: number, params: Record<string, any>): void;
}

/* ------------------------------------------------------------------ */
/* Node components (module instances attached to story nodes)          */
/* ------------------------------------------------------------------ */

export interface ComponentDef extends Registrable {
  label: string;
  description?: string;
  icon?: string;
  /** Story node types this component can be attached to; "*" for all. */
  nodeTypes: string[] | '*';
  props: PropDef[];
  defaults?(): Record<string, unknown>;
  /** Allow more than one instance per node. */
  multiple?: boolean;
  /** Runtime hooks. `data` is the instance's saved data. */
  sceneEnter?(ctx: any, data: any, instance: any): void | Promise<void>;
  sceneExit?(ctx: any, data: any, instance: any): void;
  frame?(ctx: any, data: any, dt: number, instance: any): void;
  /** For non-scene nodes: runs before the node executes. Return a port id to override routing. */
  nodeRun?(ctx: any, data: any, instance: any): void | string | Promise<void | string>;
  validate?(data: any, node: StoryNode, project: Project): Issue[];
}

/** Long-lived gameplay systems (inventory, relationships...), created once per game session. */
export interface SystemDef extends Registrable {
  label: string;
  create(rt: any): { dispose?(): void; save?(): unknown; load?(data: unknown): void; [k: string]: any };
}

export interface FunctionDef extends Registrable, Omit<ExprFunction, 'id'> {}

export class Engine {
  readonly portTypes = new Registry<PortTypeDef>('portTypes');
  readonly nodeTypes = new Registry<NodeTypeDef>('nodeTypes');
  readonly layerTypes = new Registry<LayerTypeDef>('layerTypes');
  readonly properties = new Registry<PropertyExtensionDef>('properties');
  readonly interpolators = new Registry<InterpolatorDef>('interpolators');
  readonly blocks = new Registry<BlockDef>('blocks');
  readonly effectNodes = new Registry<EffectNodeDef>('effectNodes');
  readonly transitions = new Registry<TransitionDef>('transitions');
  readonly components = new Registry<ComponentDef>('components');
  readonly systems = new Registry<SystemDef>('systems');
  readonly functions = new Registry<FunctionDef>('functions');

  all(): Registry<any>[] {
    return [this.portTypes, this.nodeTypes, this.layerTypes, this.properties, this.interpolators, this.blocks,
      this.effectNodes, this.transitions, this.components, this.systems, this.functions];
  }

  unregisterOwner(owner: string): void {
    for (const r of this.all()) r.unregisterOwner(owner);
  }

  /** All property definitions available on a layer type, including module extensions. */
  layerProps(type: string): PropDef[] {
    const def = this.layerTypes.get(type);
    const base = def ? def.props : [];
    // "*" means every visual layer (dialogue, audio and other non-visual elements are not drawn).
    const ext = this.properties.list().filter((p) => (p.layerTypes === '*' ? def?.visual !== false : p.layerTypes.includes(type))).map((p) => p.prop);
    return [...base, ...ext];
  }

  /** Expression function table merged with module-registered functions. */
  functionTable(builtins: Record<string, ExprFunction>): Record<string, ExprFunction> {
    const out: Record<string, ExprFunction> = { ...builtins };
    // Module functions are called by their local name: "com.example.relationships/affection" → affection(…).
    for (const f of this.functions.list()) {
      const name = f.id.slice(f.id.lastIndexOf('/') + 1);
      if (!(name in builtins)) out[name] = { id: name, label: f.label, args: f.args, fn: f.fn };
    }
    return out;
  }
}
