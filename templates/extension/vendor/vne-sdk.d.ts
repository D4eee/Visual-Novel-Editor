/**
 * Visual Novel Editor — public extension SDK typings (API 1.x).
 *
 * A module is a folder with a `module.json` manifest plus ES-module entry points:
 *   runtime.js  → `export function activate(api: RuntimeApi)`         (runs in editor, preview and exported games)
 *   editor.js   → `export function activateEditor(api: EditorApi)`    (runs only in the editor; never exported)
 *
 * Everything a module registers is namespaced with its id automatically:
 * registering `{ id: "skillCheck" }` from module `com.example.dice` creates `com.example.dice/skillCheck`.
 *
 * See docs/modding/ for guides and docs/api/ for the reference.
 */

/* ------------------------------------------------------------------ */
/* Project data (subset relevant to modules)                           */
/* ------------------------------------------------------------------ */

export type Id = string;
export type VarValue = number | string | boolean | (number | string | boolean)[];
export type Expr =
  | { k: 'lit'; v: VarValue }
  | { k: 'var'; id: Id }
  | { k: 'op'; op: string; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'fn'; fn: string; args: Expr[] };

export interface ModuleInstance { id: Id; moduleId: string; component: string; enabled: boolean; data: Record<string, unknown> }
export interface StoryNode<D = any> { id: Id; type: string; chapterId: Id; name: string; x: number; y: number; data: D; modules: ModuleInstance[] }
/** A value an element keeps for scripts (hp, speed…). Its live value is props["param.<id>"]. */
export interface ParamDef { id: Id; name: string; type: 'number' | 'string' | 'boolean'; initial: number | string | boolean }
export interface Layer {
  id: Id; type: string; name: string; parentId: Id | null; visible: boolean; locked: boolean; props: Record<string, any>; data?: Record<string, unknown>;
  /** Set on the group a scene preset was loaded into (API 1.6). */
  presetGroup?: Id;
  /** Custom parameters (API 1.2). */
  params?: ParamDef[];
  /** Global page only: drawn in front of (default) or behind each page's elements (API 1.2). */
  zone?: 'front' | 'back';
  /**
   * Parent element (API 1.3, "parent & link"): this element follows the parent's position,
   * rotation and scale; its x/y are measured from the parent's anchor point. Same group only.
   */
  link?: Id | null;
}
/** 'list' (API 1.2): an array of numbers, texts and booleans. */
export interface VariableDef { id: Id; name: string; type: 'number' | 'string' | 'boolean' | 'list'; initial: VarValue; scope: 'game' | 'persistent' }
/** A collectible (API 1.2). The inventory is a list variable of item names (Project.inventoryVarId). */
export interface ItemDef { id: Id; name: string; assetId: Id | null; description?: string }
export interface Character {
  id: Id; name: string; color: string; portraits: { id: Id; name: string; assetId: Id | null }[];
  /** A skeleton of image parts (API 1.6), its motions and expressions. */
  rig?: CharacterRig; motions?: CharacterMotion[]; expressions?: CharacterExpression[]; defaultMotion?: Id | null;
}
export interface RigBone { id: Id; name: string; parent: Id | null; x: number; y: number; rotation: number; scaleX: number; scaleY: number; length: number }
export interface RigAttachment { name: string; assetId: Id | null; region?: { x: number; y: number; w: number; h: number; rotated?: boolean; ox?: number; oy?: number; ow?: number; oh?: number }; x: number; y: number; rotation: number; scaleX: number; scaleY: number; width: number; height: number }
export interface RigPart { id: Id; name: string; bone: Id | null; attachments: RigAttachment[]; attachment: string | null; opacity: number }
export interface CharacterRig { width: number; height: number; origin: { x: number; y: number }; bones: RigBone[]; parts: RigPart[]; source?: 'editor' | 'spine' }
export interface RigTrack { target: 'bone' | 'part'; id: Id; prop: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity' | 'attachment'; keys: { t: number; v: any; ease?: string }[] }
export interface CharacterMotion { id: Id; name: string; kind: 'rig' | 'frames'; duration: number; loop: boolean; tracks?: RigTrack[]; frames?: Id[]; fps?: number }
export interface CharacterExpression { id: Id; name: string; parts?: Record<Id, { attachment?: string | null; opacity?: number }>; bones?: Record<Id, { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }>; portraitId?: Id | null }
export interface Asset { id: Id; name: string; kind: 'image' | 'audio' | 'video' | 'font' | 'other'; path: string; tags: string[]; meta: Record<string, unknown> }
export interface Project {
  id: Id; name: string; settings: { title: string; resolution: { width: number; height: number }; [k: string]: any };
  chapters: { id: Id; name: string }[]; nodes: Record<Id, StoryNode>; edges: { id: Id; from: { node: Id; port: string }; to: { node: Id; port: string } }[];
  variables: VariableDef[]; characters: Character[]; assets: Asset[];
  /** Collectibles and the list variable holding the inventory (API 1.2). */
  items: ItemDef[]; inventoryVarId: Id | null;
  /** Project-level data owned by modules, keyed by module id. */
  extensions: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Issue { severity: 'error' | 'warning' | 'info'; code: string; message: string; params?: Record<string, string | number>; target?: { nodeId?: Id; layerId?: Id } }

/* ------------------------------------------------------------------ */
/* Property schema — drives generated inspectors and animation          */
/* ------------------------------------------------------------------ */

export type PropType = 'number' | 'string' | 'text' | 'boolean' | 'color' | 'select' | 'asset' | 'character' | 'portrait'
  | 'variable' | 'layer' | 'animation' | 'choice' | 'node' | 'font' | 'vector' | 'json' | 'expr' | 'item' | 'composition' | 'motion' | 'expression';

export interface PropDef {
  key: string;
  type: PropType;
  /** Plain text or an i18n key from your locales. */
  label: string;
  default?: any;
  min?: number; max?: number; step?: number; unit?: string;
  options?: { value: string | number; label: string }[];
  assetKind?: 'image' | 'audio' | 'video' | 'font';
  /** Show ◆ keyframe controls; numbers and colors interpolate, other types hold. */
  animatable?: boolean;
  /** Sampling a timeline key of this prop also reports `<key>Since`: seconds since that key (API 1.6). */
  clock?: boolean;
  group?: string;
  description?: string;
  hidden?: boolean;
  /**
   * Players read this value as text: it goes into the project's translation table (API 1.4).
   * Long `text` properties and `string` properties named `text` are translatable without it.
   */
  translatable?: boolean;
}

/* ------------------------------------------------------------------ */
/* Runtime contexts                                                     */
/* ------------------------------------------------------------------ */

export interface RuntimeEvent { type: string; [k: string]: any }

export interface VarStore {
  get(id: Id): VarValue | undefined;
  set(id: Id, value: VarValue): void;
  def(id: Id): VariableDef | undefined;
  byName(name: string): VariableDef | undefined;
  events: { on(type: 'change', fn: (c: { id: Id; value: VarValue; previous: VarValue | undefined; name: string }) => void): () => void };
}

export interface AudioApi {
  playSound(assetId: Id, volume?: number, category?: 'sfx' | 'voice' | 'ambient'): HTMLAudioElement | null;
  playMusic(assetId: Id, volume?: number, loop?: boolean, fade?: number): void;
  stopMusic(fade?: number): void;
}

/** The running game (editor preview or exported game). */
export interface GameApi {
  /** Mouse position (stage pixels), button and held keys (KeyboardEvent.code). */
  readonly input: InputState;
  readonly mode: 'game' | 'preview';
  readonly project: Project;
  readonly vars: VarStore;
  readonly audio: AudioApi;
  /** Game-wide event bus. Scene events are re-published here with `sceneId`. */
  readonly events: { on(type: string, fn: (e: any) => void): () => void; emit(type: string, e: any): void };
  /** DOM layer above the scene for HUDs (stage coordinates; scaled with the game). */
  readonly hud: HTMLElement;
  readonly i18n: { t(key: string, params?: Record<string, any>): string; locale: string };
  readonly scene: SceneApi | null;
  /** Collectibles (API 1.2). Items are given by id or name. */
  readonly items: ItemsApi;
  readonly currentNodeId: Id | null;
  readonly time: number;
  system<T = any>(id: string): T | undefined;
  gotoNode(nodeId: Id): void;
  save(slot: string): unknown;
  load(slot: string): boolean;
  toast(message: string): void;
  debugLog(message: string): void;
  evaluate(expr: Expr): VarValue;
  sleep(seconds: number): Promise<void>;
}

/** The player's collectibles (API 1.2). */
export interface ItemsApi {
  has(item: string): boolean;
  count(item: string): number;
  /** Add to the inventory (fires "item.collected"). */
  add(item: string, amount?: number): void;
  /** Take one (or every) item of that kind (fires "item.removed"). */
  remove(item: string, all?: boolean): void;
  /** Select an item to use it on an element (fires "item.selected"); null deselects. */
  select(item: string | null): void;
  readonly selected: string | null;
  /** Item names in the inventory (or another list variable). */
  list(listVar?: Id | null): string[];
}

/** The scene that is playing. Layer ids or layer names are accepted. */
export interface SceneApi {
  readonly node: StoryNode;
  readonly lineIndex: number;
  getProp(layer: string, prop: string): any;
  setProp(layer: string, prop: string, value: any): void;
  setVisible(layer: string, visible: boolean): void;
  tween(layer: string, prop: string, to: any, seconds: number, ease?: string): Promise<void>;
  playAnimation(animationId: Id): Promise<void>;
  stopAnimation(animationId: Id): void;
  media(layer: string, action: 'play' | 'pause' | 'stop'): void;
  setChoiceVisible(choiceId: Id, visible: boolean): void;
  /** Choose a choice programmatically (if currently offered). */
  pickChoice(choiceId: Id): boolean;
  availableChoices(): { choice: { id: Id; text: string }; disabled: boolean }[];
  gotoLine(lineId: Id): void;
  advance(): void;
  setTextboxVisible(visible: boolean): void;
  /** Leave the scene through an output port ("next" or "c:<choiceId>"). */
  exit(port: string): void;
  dispatch(e: RuntimeEvent): number;
  shake(intensity: number, seconds: number): Promise<void>;
  flash(color: string, seconds: number): Promise<void>;
  /** Sensing. Elements are given by id (or name). Points are stage pixels; default: the mouse. */
  contains(layer: string, x?: number, y?: number): boolean;
  touching(layer: string, other: string): boolean;
  isVisible(layer: string): boolean;
  bounds(layer: string): { x: number; y: number; width: number; height: number } | null;
  /** Seconds since the scene started or the timer was reset. */
  readonly timer: number;
  resetTimer(): void;
  /** Every element on the page: global (behind), inherited, own, labels, global (in front). API 1.2. */
  readonly layers: Layer[];
  /** Where an element comes from on this page (API 1.2). */
  layerOrigin(layer: string): 'own' | 'carried' | 'global' | 'label' | null;
  /** Bring an element in front of / behind everything (API 1.2). */
  reorder(layer: string, to: 'front' | 'back'): void;
  /** Pause / resume an element's media, animations and frame playback (API 1.2). */
  pauseElement(layer: string): void;
  resumeElement(layer: string | null): void;
  /** Show text at a position; the value is re-read every frame (API 1.2). */
  showLabel(name: string, value: () => string, x: number, y: number, style?: { fontSize?: number; color?: string; align?: 'left' | 'center' | 'right' }, global?: boolean): void;
  hideLabel(name: string | null): void;
  /** Hide an element and put an item in the inventory; it stays gone when the page is visited again (API 1.2). */
  pickUp(layer: string, item: string | null): void;
}

/** Pointer and keyboard state (runtime.input in blocks: ctx.runtime.input). */
export interface InputState { readonly x: number; readonly y: number; readonly down: boolean; readonly keys: ReadonlySet<string> }

/** Given to visual-scripting blocks. */
export interface ScriptContext {
  readonly project: Project;
  readonly vars: VarStore;
  readonly scene: SceneApi | null;
  /** The game; `ctx.runtime.input` has the mouse position, button and held keys. */
  readonly runtime: GameApi;
  readonly cancelled: boolean;
  /** The event that started this script (hat), if any. */
  readonly event: RuntimeEvent | null;
  evaluate(v: unknown): VarValue;
  wait(seconds: number): Promise<void>;
  waitUntil(cond: () => boolean, timeoutSeconds?: number): Promise<void>;
  runBody(blocks: Block[] | undefined): Promise<void>;
  emit(e: RuntimeEvent): void;
  stop(): never;
}

/** Given to story node `run()`. */
export interface StoryContext {
  readonly runtime: GameApi;
  readonly project: Project;
  readonly vars: VarStore;
  evaluate(e: Expr | null): VarValue;
  evaluateBool(e: Expr | null): boolean;
  sleep(seconds: number): Promise<void>;
  random(): number;
  /** Read a data input port (pull-evaluated from the connected node). */
  input(portId: string): Promise<VarValue | undefined>;
  runActions(blocks: Block[]): Promise<void>;
  warn(message: string): void;
}

/** Given to node components (module instances on story nodes). */
export interface ComponentContext {
  readonly runtime: GameApi;
  readonly scene: SceneApi;
  readonly vars: VarStore;
  readonly data: Record<string, unknown>;
  readonly instanceId: Id;
  readonly overlay: HTMLElement;
  on(type: string, fn: (e: RuntimeEvent) => void): () => void;
  emit(e: RuntimeEvent): void;
}

export interface RenderContext {
  /** 2D context; origin is the layer's top-left corner in layer space. */
  ctx: CanvasRenderingContext2D;
  mode: 'edit' | 'play';
  time: number;
  project: Project;
  assets: { image(assetId: Id | null | undefined): HTMLImageElement | null; url(assetId: Id | null | undefined): string | null };
  /** Size of the layer being drawn (local space is 0..width × 0..height). */
  width?: number;
  height?: number;
  drawChildren(parentId: Id | null): void;
}

/** Given to LayerTypeDef.size(). `measure` is a scratch 2D context for measuring text. */
export interface SizeContext {
  project: Project;
  assets: RenderContext['assets'];
  measure: CanvasRenderingContext2D;
}

export interface Block { id: Id; type: string; args: Record<string, unknown>; body?: Block[]; else?: Block[] }

/* ------------------------------------------------------------------ */
/* Definitions modules register                                        */
/* ------------------------------------------------------------------ */

export interface PortDef { id: string; label?: string; type: string; multiple?: boolean }
export type NodeRunResult = string | null | { goto: Id } | { end: true };

export interface NodeTypeDef {
  id: string;
  label: string;
  category?: 'flow' | 'scene' | 'logic' | 'organize' | 'module';
  color: string;
  icon?: string;
  description?: string;
  creatable?: boolean;
  createData(project: Project): any;
  inputs(node: StoryNode, project: Project): PortDef[];
  outputs(node: StoryNode, project: Project): PortDef[];
  summary?(node: StoryNode, project: Project, t: (k: string, p?: any) => string): string;
  /** "logic" opens the generic node workspace (form from `props` + Modules tab). */
  workspace?: string;
  props?: PropDef[];
  run?(node: StoryNode, ctx: StoryContext): NodeRunResult | Promise<NodeRunResult>;
  evaluate?(node: StoryNode, port: string, ctx: StoryContext): VarValue | Promise<VarValue>;
  validate?(node: StoryNode, project: Project): Issue[];
}

export interface PortTypeDef { id: string; label: string; color: string; kind: 'flow' | 'data'; accepts?: string[] }

export interface LayerInstance {
  update?(dt: number, props: Record<string, any>, time: number): void;
  draw?(rc: RenderContext, props: Record<string, any>): void;
  play?(offset?: number): void; pause?(): void; stop?(): void; dispose?(): void;
  [k: string]: any;
}

export interface LayerTypeDef {
  id: string;
  label: string;
  icon?: string;
  category: 'media' | 'text' | 'ui' | 'interactive' | 'effect' | 'structure' | 'module';
  visual: boolean;
  /** Transform props (x, y, scale, rotation, anchor, opacity) are added automatically for visual layers. */
  props: PropDef[];
  defaults?(ctx: { project: Project; width: number; height: number }): Record<string, any>;
  size?(layer: Layer, props: Record<string, any>, rc: SizeContext): { width: number; height: number };
  draw?(rc: RenderContext, layer: Layer, props: Record<string, any>): void;
  createInstance?(layer: Layer, rt: { mode: 'edit' | 'play'; emit(e: RuntimeEvent): void; requestRender(): void; assets: any; audio: any }): LayerInstance;
  /**
   * Precise hit test in local coordinates (0..width, 0..height). Used for clicks, hover,
   * the "mouse inside" block and scene.contains(). Default: the whole rectangle.
   */
  hitTest?(layer: Layer, props: Record<string, any>, x: number, y: number, size: { width: number; height: number }): boolean;
  /** Advance live state each frame while the game plays; change `state` in place (API 1.2). */
  step?(state: Record<string, any>, dt: number, ctx: { layer: Layer; emit(e: RuntimeEvent): void; runtime: GameApi }): void;
  /** A click in local coordinates while the game plays; return true when handled (API 1.2). */
  pointer?(layer: Layer, props: Record<string, any>, x: number, y: number, size: { width: number; height: number }, ctx: { emit(e: RuntimeEvent): void; runtime: GameApi }): boolean;
  /** Always receives clicks, even when no script listens (API 1.2). */
  interactive?: boolean;
}

export interface PropertyExtensionDef {
  id: string;
  /** Layer types that get the property, or "*" for every layer type. */
  layerTypes: string[] | '*';
  prop: PropDef;
  /** Called while drawing the layer. "transform" and "before" run before content, "after" (default) after it. */
  apply?(rc: RenderContext, layer: Layer, props: Record<string, any>, value: any): void;
  phase?: 'before' | 'after' | 'transform';
}

export interface InterpolatorDef { id: string; label: string; ease(t: number, keyframe?: any): number; discrete?: boolean }

export interface BlockArgDef {
  id: string;
  type: 'number' | 'string' | 'boolean' | 'layer' | 'animation' | 'variable' | 'asset' | 'choice' | 'line' | 'key' | 'select' | 'expr' | 'port' | 'node' | 'character' | 'portrait' | 'behavior' | 'prop' | 'ease' | 'message'
    | 'item' | 'param' | 'motion' | 'expression';
  default?: any;
  options?: { value: string | number; label: string }[];
  assetKind?: 'image' | 'audio' | 'video';
  /** `layer` arguments: element types the slot accepts (default: any). */
  layerTypes?: string[];
  /** `variable` arguments: only variables of this type, e.g. 'list' (API 1.2). */
  varType?: 'number' | 'string' | 'boolean' | 'list';
  /** `param` arguments: id of the `layer` argument whose parameters are listed (API 1.2). */
  paramOf?: string;
  /** May be left empty (passed as null) (API 1.2). */
  optional?: boolean;
  /** `string` / `message` arguments players read: listed in the translation table (API 1.4). */
  translatable?: boolean;
}

/**
 * hat: starts a script · statement / c / c-else / cap: script steps ·
 * reporter (round) / boolean (pointed): values dropped into other blocks' slots.
 * Categories: elements, events, control, looks, game, sound, sensing, operators, variables, story, or your own.
 */
export interface BlockDef {
  id: string;
  category: string;
  shape: 'hat' | 'statement' | 'c' | 'c-else' | 'cap' | 'reporter' | 'boolean';
  /** Template with {argId} placeholders, e.g. "Shake {layer} for {seconds} s". Plain text or i18n key. */
  label: string;
  args: BlockArgDef[];
  color?: string;
  context?: 'scene' | 'story' | 'both';
  /**
   * API 1.3: nothing can follow this block (it never finishes, like "forever"). The editor
   * draws it without a bottom connector and only lets it end a script. `cap` blocks already
   * end a script; set this on a `c` block.
   */
  endsScript?: boolean;
  run?(ctx: ScriptContext, args: Record<string, any>, block: Block): void | Promise<void>;
  /** Reporter / boolean blocks: return the value (synchronously). Arguments arrive already evaluated, nested blocks included. */
  report?(ctx: ScriptContext, args: Record<string, any>, block: Block): any;
  /**
   * Blocks with a `layer` argument are listed under each element in the Interactions
   * palette, pre-filled with it. Limit that to some element types (your module's layer
   * types, 'core.audio', …) or use ['*'] for every element including non-visual ones.
   * Default: every visible element.
   */
  layerTypes?: string[];
  /** Hats: the event type that triggers this script. */
  event?: string;
  matches?(event: RuntimeEvent, args: Record<string, any>): boolean;
  setup?(ctx: ScriptContext, args: Record<string, any>, fire: () => void): (() => void) | void;
}

export interface EffectPortDef { id: string; label: string; type: 'image' | 'number' | 'color' | 'boolean' | 'select' | 'string' | 'layer' | 'prop' | 'variable'; default?: any; min?: number; max?: number; step?: number; options?: { value: string | number; label: string }[]; inlineOnly?: boolean }

export interface EffectContext {
  time: number;
  width: number; height: number;
  input: HTMLCanvasElement | null;
  pool: { acquire(w: number, h: number): HTMLCanvasElement };
  /** Run a GLSL ES 1.0 fragment shader. Uniforms: u_image, u_size, u_time, varying uv. */
  shaders: { run(pool: any, frag: string, input: HTMLCanvasElement, uniforms?: Record<string, number | number[]>, time?: number): HTMLCanvasElement };
  vars: VarStore;
  layerProps(layerId: Id): Record<string, any> | undefined;
  drive(layerId: Id | '', prop: string, value: any): void;
  errors: string[];
}

export interface EffectNodeDef {
  id: string;
  label: string;
  category: 'color' | 'filter' | 'distort' | 'generate' | 'composite' | 'math' | 'value' | 'drive' | 'module';
  inputs: EffectPortDef[];
  outputs: EffectPortDef[];
  evaluate(ctx: EffectContext, inputs: Record<string, any>, node: { id: Id; values: Record<string, any> }): Record<string, any>;
  animated?: boolean;
}

export interface TransitionDef { id: string; label: string; params?: PropDef[]; draw(ctx: CanvasRenderingContext2D, from: CanvasImageSource, to: CanvasImageSource, progress: number, params: Record<string, any>): void }

export interface ComponentDef {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  /** Node types this component can be attached to ("core.scene", "core.event", …) or "*". */
  nodeTypes: string[] | '*';
  /** Settings schema; rendered automatically in the node's Modules workspace. */
  props: PropDef[];
  defaults?(): Record<string, unknown>;
  multiple?: boolean;
  sceneEnter?(ctx: ComponentContext, data: any, state: any): void | Promise<void>;
  sceneExit?(ctx: ComponentContext, data: any, state: any): void;
  frame?(ctx: ComponentContext, data: any, dt: number, state: any): void;
  /** Non-scene nodes: runs before the node; return an output port id to override routing. */
  nodeRun?(ctx: { runtime: GameApi; vars: VarStore; data: any; node: StoryNode; overlay: HTMLElement }, data: any, state: any): void | string | Promise<void | string>;
  validate?(data: any, node: StoryNode, project: Project): Issue[];
}

export interface SystemInstance { dispose?(): void; save?(): unknown; load?(data: unknown): void; [k: string]: any }
export interface SystemDef { id: string; label: string; create(game: GameApi): SystemInstance }
export interface FunctionDef { id: string; label: string; args: number; fn(...args: VarValue[]): VarValue }

interface Registrar<T> { register(def: T): () => void; unregister(id: string): void; get(id: string): T | undefined; list(): T[] }

/* ------------------------------------------------------------------ */
/* Runtime API — `export function activate(api)` in runtime.js          */
/* ------------------------------------------------------------------ */

export interface RuntimeApi {
  readonly id: string;
  readonly manifest: ModuleManifest;
  readonly apiVersion: string;
  readonly engineVersion: string;
  readonly mode: 'editor' | 'preview' | 'game';
  nodes: Registrar<NodeTypeDef>;
  ports: Registrar<PortTypeDef>;
  layers: Registrar<LayerTypeDef>;
  properties: Registrar<PropertyExtensionDef>;
  interpolators: Registrar<InterpolatorDef>;
  blocks: Registrar<BlockDef>;
  effects: Registrar<EffectNodeDef>;
  transitions: Registrar<TransitionDef>;
  components: Registrar<ComponentDef>;
  systems: Registrar<SystemDef>;
  /** Functions usable in expressions, e.g. `affection("Mika")`. */
  functions: Registrar<FunctionDef>;
  i18n: { t(key: string, params?: Record<string, any>): string; add(locale: string, dict: Record<string, string>): void; readonly locale: string };
  /** URL of a file inside the module folder (works in editor and exported games). */
  assetUrl(path: string): string;
  log: { info(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };
  /** Namespaced key/value storage; null unless the manifest requests the "storage" permission. */
  storage: { get(key: string): any; set(key: string, value: unknown): void; remove(key: string): void } | null;
}

/* ------------------------------------------------------------------ */
/* Editor API — `export function activateEditor(api)` in editor.js     */
/* ------------------------------------------------------------------ */

export interface MountContext {
  moduleId: string;
  project(): Project;
  update(label: string, recipe: (draft: Project) => void, opts?: { mergeKey?: string }): void;
  onChange(fn: () => void): () => void;
  t(key: string, params?: Record<string, string | number>): string;
  locale(): string;
  toast(text: string, kind?: 'info' | 'error' | 'success'): void;
  openNode(nodeId: Id): void;
  nodeId?: Id;
  instanceId?: Id;
  layerId?: Id;
  data?: Record<string, unknown>;
  setData?(patch: Record<string, unknown>, label?: string): void;
  setLayerProps?(patch: Record<string, unknown>, label?: string): void;
}

/** Mount UI into `el`; return a cleanup function. Use any framework or plain DOM. */
export type Mount = (el: HTMLElement, ctx: MountContext) => void | (() => void);

export interface EditorApi {
  readonly id: string;
  readonly manifest: ModuleManifest;
  readonly apiVersion: string;
  i18n: RuntimeApi['i18n'];
  log: RuntimeApi['log'];
  project: {
    get(): Project;
    /** Undoable change. The draft is copy-on-write; mutate it freely. */
    update(label: string, recipe: (draft: Project) => void, opts?: { mergeKey?: string }): void;
    onChange(fn: () => void): () => void;
    /** project.extensions[moduleId] */
    getData<T = any>(): T | null;
    setData(value: unknown, label?: string): void;
  };
  selection: { nodes(): Id[]; openNode(nodeId: Id): void };
  /** Panels in the left sidebar or the scene editor's bottom dock. */
  panels: Registrar<{ id: string; title: string; icon?: string; location: 'sidebar' | 'bottom'; mount: Mount }>;
  /** Extra inspector section for a layer type. */
  inspectors: Registrar<{ id: string; target: string; title?: string; mount: Mount }>;
  /** Custom UI inside a node's Modules workspace for one of your components. */
  nodeWorkspaces: Registrar<{ id: string; component: string; mount: Mount }>;
  /** Full workspaces opened as editor tabs. */
  workspaces: Registrar<{ id: string; title: string; icon?: string; mount: Mount }>;
  toolbar: Registrar<{ id: string; label: string; icon?: string; run(ctx: MountContext): void }>;
  importers: Registrar<{ id: string; label: string; extensions: string[]; import(files: { name: string; text?: string; base64: string }[], ctx: MountContext): void | Promise<void> }>;
  exporters: Registrar<{ id: string; label: string; run(ctx: MountContext): void | Promise<void> }>;
  assetUrl(path: string): string;
}

/* ------------------------------------------------------------------ */
/* Manifest                                                             */
/* ------------------------------------------------------------------ */

export interface ModuleManifest {
  id: string;
  name: string | Record<string, string>;
  version: string;
  description?: string | Record<string, string>;
  author?: string | { name: string; email?: string; url?: string };
  license?: string;
  homepage?: string;
  engine: string;
  api?: string;
  dependencies?: Record<string, string>;
  kind?: 'editor' | 'runtime' | 'combined';
  provides?: Partial<Record<'nodes' | 'layers' | 'blocks' | 'effects' | 'components' | 'properties' | 'interpolators' | 'transitions' | 'portTypes' | 'systems' | 'panels' | 'inspectors' | 'nodeWorkspaces' | 'workspaces' | 'toolbar' | 'importers' | 'exporters', string[]>>;
  runtime?: string;
  editor?: string;
  locales?: string;
  assets?: string;
  permissions?: ('storage' | 'network' | 'clipboard' | 'fullscreen')[];
  icon?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers in @vne/sdk (sdk/dist/index.js)                              */
/* ------------------------------------------------------------------ */

export declare const SDK_VERSION: string;
export declare function defineRuntime(activate: (api: RuntimeApi) => void | (() => void) | Promise<void | (() => void)>): (api: RuntimeApi) => any;
export declare function defineEditor(activate: (api: EditorApi) => void | (() => void) | Promise<void | (() => void)>): (api: EditorApi) => any;
/** Tiny DOM helper for editor UIs: h('div', { class: 'row', onclick }, 'text', child). */
export declare function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, any> | null, ...children: (Node | string | number | null | undefined | false)[]): HTMLElementTagNameMap[K];
/** Pre-styled controls matching the editor's look. */
export declare const ui: {
  button(label: string, onClick: () => void, opts?: { primary?: boolean; small?: boolean }): HTMLButtonElement;
  field(label: string, control: HTMLElement, hint?: string): HTMLElement;
  text(value: string, onChange: (v: string) => void, opts?: { placeholder?: string; multiline?: boolean }): HTMLInputElement | HTMLTextAreaElement;
  number(value: number, onChange: (v: number) => void, opts?: { min?: number; max?: number; step?: number }): HTMLInputElement;
  slider(value: number, onChange: (v: number) => void, opts?: { min?: number; max?: number; step?: number }): HTMLInputElement;
  select(value: string, options: { value: string; label: string }[], onChange: (v: string) => void): HTMLSelectElement;
  checkbox(value: boolean, onChange: (v: boolean) => void, label?: string): HTMLLabelElement;
  color(value: string, onChange: (v: string) => void): HTMLInputElement;
};
