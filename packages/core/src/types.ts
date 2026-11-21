/**
 * Unified project data model.
 *
 * Every persistent entity has a stable string id. Display names are never used
 * as references. Unknown fields (for example data written by a module that is
 * not installed right now) are preserved because the project is kept as plain
 * JSON and edited with copy-on-write updates that never drop keys.
 */

export type Id = string;

export const PROJECT_FORMAT = 'vne.project';
export const PROJECT_FORMAT_VERSION = 4;

export interface Project {
  format: typeof PROJECT_FORMAT;
  formatVersion: number;
  engineVersion: string;
  id: Id;
  name: string;
  created: string;
  modified: string;
  settings: ProjectSettings;
  chapters: Chapter[];
  nodes: Record<Id, StoryNode>;
  edges: StoryEdge[];
  variables: VariableDef[];
  characters: Character[];
  assets: Asset[];
  compositions: Composition[];
  effectGraphs: EffectGraph[];
  behaviors: Behavior[];
  /** Modules this project depends on. */
  modules: ModuleDependency[];
  /** Project-level data owned by modules, keyed by module id. Never removed automatically. */
  extensions: Record<string, unknown>;
  /** Collectible items (Game module): picked up in scenes, kept in the inventory list. */
  items: ItemDef[];
  /** The list variable that is the player's inventory (holds item names). */
  inventoryVarId: Id | null;
  /** Editor-only view state (stripped from exported games). */
  editor?: EditorState;
  [key: string]: unknown;
}

export interface EditorState {
  views?: Record<Id, { x: number; y: number; zoom: number }>;
  lastChapterId?: Id;
}

export interface ProjectSettings {
  title: string;
  version: string;
  author: string;
  identifier: string;
  description?: string;
  resolution: { width: number; height: number };
  window: {
    mode: 'windowed' | 'fullscreen' | 'borderless';
    resizable: boolean;
    width: number;
    height: number;
    allowFullscreenToggle: boolean;
  };
  iconAssetId?: Id | null;
  /** Characters per second for the typewriter effect. 0 = instant. */
  textSpeed: number;
  autoAdvanceDelay: number;
  textbox: TextboxStyle;
  titleScreen: { backgroundAssetId?: Id | null; musicAssetId?: Id | null; showTitle: boolean };
  defaultTransition: TransitionRef;
  [key: string]: unknown;
}

export interface TextboxStyle {
  position: 'bottom' | 'top' | 'center';
  height: number;
  margin: number;
  padding: number;
  background: string;
  borderColor: string;
  borderRadius: number;
  textColor: string;
  nameColor: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  showPortrait: boolean;
  choiceBackground: string;
  choiceHover: string;
  choiceTextColor: string;
}

export interface TransitionRef {
  type: string;
  duration: number;
  params?: Record<string, unknown>;
}

export interface Chapter {
  id: Id;
  name: string;
  color?: string;
  /** Node that "begin current chapter" preview starts from. Optional; derived when absent. */
  entryNodeId?: Id | null;
  notes?: string;
}

export interface StoryNode<D = any> {
  id: Id;
  type: string;
  chapterId: Id;
  name: string;
  x: number;
  y: number;
  data: D;
  /** Module instances attached to this node. */
  modules: ModuleInstance[];
  color?: string;
  notes?: string;
}

export interface PortRef {
  node: Id;
  port: string;
}

export interface StoryEdge {
  id: Id;
  from: PortRef;
  to: PortRef;
}

export type VarType = 'number' | 'string' | 'boolean' | 'list';
/** Lists hold numbers, text and true/false values (not other lists). */
export type VarValue = number | string | boolean | ScalarValue[];
export type ScalarValue = number | string | boolean;

export interface VariableDef {
  id: Id;
  name: string;
  type: VarType;
  initial: VarValue;
  /** game: saved with progress; persistent: shared by all saves (e.g. unlocked endings). */
  scope: 'game' | 'persistent';
  description?: string;
}

/** A collectible item. The inventory list stores item names, so conditions read naturally: has("Key"). */
export interface ItemDef {
  id: Id;
  name: string;
  /** Icon shown in inventories (image asset). */
  assetId: Id | null;
  description?: string;
}

/** A custom parameter of an element (e.g. hp, maxHp of a health bar). Its value lives in props["param.<id>"]. */
export interface ParamDef {
  id: Id;
  name: string;
  type: 'number' | 'string' | 'boolean';
  initial: ScalarValue;
}

export interface Character {
  id: Id;
  name: string;
  color: string;
  portraits: Portrait[];
  description?: string;
}

export interface Portrait {
  id: Id;
  name: string;
  assetId: Id | null;
}

export type AssetKind = 'image' | 'audio' | 'video' | 'font' | 'other';

export interface Asset {
  id: Id;
  name: string;
  kind: AssetKind;
  /** Path relative to the project folder, always with forward slashes. */
  path: string;
  size?: number;
  hash?: string;
  tags: string[];
  meta: { width?: number; height?: number; duration?: number; [k: string]: unknown };
  imported?: string;
}

export interface Composition {
  id: Id;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
}

export interface Behavior {
  id: Id;
  name: string;
  body: Block[];
}

export interface ModuleDependency {
  id: string;
  version: string;
  enabled: boolean;
}

export interface ModuleInstance {
  id: Id;
  moduleId: string;
  /** Component type registered by the module, e.g. "com.example.inventory/sceneItems". */
  component: string;
  enabled: boolean;
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

export interface SceneData {
  number: string;
  background: string;
  layers: Layer[];
  animations: AnimationClip[];
  /* Dialogue lines and choices are layers since format 2 (see elements.ts). */
  scripts: ScriptStack[];
  /** Variables that exist only while the scene is playing. */
  localVariables: VariableDef[];
  transition: TransitionRef | null;
  hideTextbox: boolean;
  /** When there is no dialogue and no choices, how long the scene stays before continuing (0 = wait for click). */
  holdSeconds: number;
  [key: string]: unknown;
}

export interface Layer {
  id: Id;
  type: string;
  name: string;
  parentId: Id | null;
  visible: boolean;
  locked: boolean;
  props: Record<string, any>;
  effect?: LayerEffect | null;
  blend?: string;
  /** Free-form data for module-defined layers. */
  data?: Record<string, unknown>;
  /** Set on a group made by "Edit as layers" from a reusable composition, so it can update that composition. */
  sourceCompositionId?: Id;
  /** Custom parameters (Game module); values in props["param.<id>"]. */
  params?: ParamDef[];
  /** Global elements only: drawn in front of (default) or behind every page's own elements. */
  zone?: 'front' | 'back';
  /**
   * Parent element ("parent & link", like After Effects): this element moves, turns and scales
   * with it, and its position is measured from the parent's anchor point. Unlike a group, the
   * element keeps its own place in the layer order and its own opacity. Both must sit in the
   * same group (or both at the top level).
   */
  link?: Id | null;
}

export type LayerEffect =
  | { kind: 'inline'; graph: EffectGraph }
  | { kind: 'ref'; graphId: Id; params: Record<string, number | string | boolean> };

export interface AnimationClip {
  id: Id;
  name: string;
  duration: number;
  loop: boolean;
  autoplay: boolean;
  tracks: Track[];
  media: MediaClip[];
  /**
   * In and out points of elements in this animation (After Effects-style layer bars): while
   * the animation plays, the element is shown only from `in` to `out` (seconds; `out` null =
   * to the end). Elements without an entry are shown the whole time.
   */
  spans?: Record<Id, { in: number; out: number | null }>;
  /** Named points in time (editor aid: snapping and jumping). */
  markers?: { id: Id; t: number; label: string; color?: string }[];
  /** Part of the animation the editor previews and loops (editor only). */
  workArea?: { start: number; end: number } | null;
}

export interface Track {
  id: Id;
  layerId: Id;
  prop: string;
  keyframes: Keyframe[];
}

export interface Keyframe {
  id: Id;
  t: number;
  v: any;
  /** Interpolator id used from this keyframe to the next. */
  ease: string;
  /** Cubic bezier control points for the "bezier" interpolator. */
  bez?: [number, number, number, number];
}

export interface MediaClip {
  id: Id;
  layerId: Id;
  start: number;
  trimIn: number;
  duration: number | null;
}

export interface DialogueLine {
  id: Id;
  speakerId: Id | null;
  speakerName?: string;
  portraitId?: Id | null;
  text: string;
  voiceAssetId?: Id | null;
  /** Seconds to wait before auto-advancing; 0 = wait for player. */
  auto?: number;
}

export interface Choice {
  id: Id;
  text: string;
  condition: Expr | null;
  /** If true the choice starts hidden and is revealed by a script. */
  hidden: boolean;
  /** What to do when the condition is false. */
  unavailable: 'hide' | 'disable';
  effects: VarOp[];
  /** Optional animation played before leaving the scene. */
  animationId?: Id | null;
  /** Only offered when the inventory holds this item (by name); `consumeItem` takes it away when picked. */
  requiresItem?: string | null;
  consumeItem?: boolean;
}

export interface VarOp {
  varId: Id;
  op: 'set' | 'add' | 'sub' | 'toggle';
  value: VarValue;
}

/* ------------------------------------------------------------------ */
/* Visual scripting                                                    */
/* ------------------------------------------------------------------ */

export interface ScriptStack {
  id: Id;
  x: number;
  y: number;
  enabled: boolean;
  hat: Block;
  body: Block[];
}

export interface Block {
  id: Id;
  type: string;
  args: Record<string, ArgValue>;
  body?: Block[];
  else?: Block[];
}

export type ArgValue = VarValue | null | Expr | BlockRef;

/* ------------------------------------------------------------------ */
/* Expressions (shared by conditions, choices, scripts and events)    */
/* ------------------------------------------------------------------ */

export type Expr =
  | { k: 'lit'; v: VarValue }
  | { k: 'var'; id: Id }
  | { k: 'op'; op: BinaryOp; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'fn'; fn: string; args: Expr[] };

/**
 * A reporter or boolean block placed in another block's slot (Scratch-style).
 * Stored as the slot's value; evaluated when the outer block runs.
 */
export interface BlockRef { k: 'block'; block: Block }

export function isBlockRef(v: unknown): v is BlockRef {
  return !!v && typeof v === 'object' && (v as any).k === 'block' && !!(v as any).block && typeof (v as any).block.type === 'string';
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'and' | 'or' | 'contains' | 'startsWith' | 'join';

/* ------------------------------------------------------------------ */
/* Procedural effect graphs                                            */
/* ------------------------------------------------------------------ */

export interface EffectGraph {
  id: Id;
  name: string;
  nodes: EffectNode[];
  edges: EffectEdge[];
  params: EffectParam[];
}

export interface EffectNode {
  id: Id;
  type: string;
  x: number;
  y: number;
  values: Record<string, any>;
}

export interface EffectEdge {
  id: Id;
  from: PortRef;
  to: PortRef;
}

export interface EffectParam {
  id: Id;
  name: string;
  type: 'number' | 'color' | 'boolean';
  default: any;
  min?: number;
  max?: number;
}

/* ------------------------------------------------------------------ */
/* Built-in node data                                                  */
/* ------------------------------------------------------------------ */

export interface EventData {
  actions: Block[];
}

export interface ConditionData {
  expr: Expr | null;
}

export interface JumpData {
  number: number;
}

export interface EndingData {
  label: string;
  behavior: 'title' | 'restart' | 'quit';
  message: string;
  /** Persistent variable set to true when the ending is reached (for ending galleries). */
  unlockVarId?: Id | null;
}

export interface RandomData {
  branches: { id: Id; label: string; weight: number }[];
}

export interface WaitData {
  seconds: number;
}

export interface CommentData {
  text: string;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: IssueSeverity;
  code: string;
  /** i18n key with {param} placeholders. */
  message: string;
  params?: Record<string, string | number>;
  target?: IssueTarget;
}

export interface IssueTarget {
  nodeId?: Id;
  chapterId?: Id;
  layerId?: Id;
  assetId?: Id;
  moduleId?: string;
  edgeId?: Id;
}
