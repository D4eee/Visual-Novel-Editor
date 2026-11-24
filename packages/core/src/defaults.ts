import type { Chapter, Project, ProjectSettings, SceneData, StoryNode, Layer, AnimationClip, DialogueLine, Choice } from './types';
import { PROJECT_FORMAT, PROJECT_FORMAT_VERSION } from './types';
import { newId } from './util';
import type { Engine } from './registry';

export const ENGINE_VERSION = '1.2.0';
/** Public extension API major version. Modules declare `"api": "1"`. */
export const API_VERSION = '1.6.0';

export function defaultSettings(name: string): ProjectSettings {
  return {
    title: name,
    version: '1.0.0',
    author: '',
    identifier: `com.example.${name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'game'}`,
    resolution: { width: 1280, height: 720 },
    window: { mode: 'windowed', resizable: true, width: 1280, height: 720, allowFullscreenToggle: true },
    iconAssetId: null,
    textSpeed: 40,
    autoAdvanceDelay: 1.5,
    textbox: {
      position: 'bottom',
      height: 200,
      margin: 24,
      padding: 24,
      background: 'rgba(12, 14, 24, 0.82)',
      borderColor: 'rgba(255, 255, 255, 0.14)',
      borderRadius: 14,
      textColor: '#f4f1ea',
      nameColor: '#ffd38a',
      fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 26,
      lineHeight: 1.5,
      showPortrait: true,
      choiceBackground: 'rgba(16, 18, 30, 0.86)',
      choiceHover: 'rgba(70, 90, 160, 0.92)',
      choiceTextColor: '#ffffff',
    },
    titleScreen: { backgroundAssetId: null, musicAssetId: null, showTitle: true },
    defaultTransition: { type: 'fade', duration: 0.5 },
  };
}

export function createChapter(name: string): Chapter {
  return { id: newId('chp'), name, entryNodeId: null };
}

export function createProject(name: string): Project {
  const now = new Date().toISOString();
  const chapter = createChapter('Chapter 1');
  const project: Project = {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    id: newId('prj'),
    name,
    created: now,
    modified: now,
    settings: defaultSettings(name),
    chapters: [chapter],
    nodes: {},
    edges: [],
    variables: [],
    characters: [],
    assets: [],
    compositions: [],
    effectGraphs: [],
    behaviors: [],
    modules: [],
    extensions: {},
    items: [],
    inventoryVarId: null,
    editor: { views: {}, lastChapterId: chapter.id },
  };
  ensureGlobalNode(project);
  return project;
}

export function createSceneData(number = '1'): SceneData {
  return {
    number,
    background: '#1b1d2a',
    layers: [],
    animations: [],
    scripts: [],
    localVariables: [],
    transition: null,
    hideTextbox: false,
    holdSeconds: 0,
  };
}

export function createDialogueLine(text = '', speakerId: string | null = null): DialogueLine {
  return { id: newId('dlg'), speakerId, text, portraitId: null, voiceAssetId: null, auto: 0 };
}

export function createChoice(text: string): Choice {
  return { id: newId('cho'), text, condition: null, hidden: false, unavailable: 'hide', effects: [], animationId: null };
}

export function createAnimation(name: string, duration = 2): AnimationClip {
  return { id: newId('anm'), name, duration, loop: false, autoplay: false, tracks: [], media: [] };
}

/** Transform properties shared by every visual layer. */
export const TRANSFORM_DEFAULTS = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
  opacity: 1,
};

export function createLayer(engine: Engine, project: Project, type: string, name?: string, extra: Record<string, any> = {}): Layer {
  const def = engine.layerTypes.get(type);
  const { width, height } = project.settings.resolution;
  const props: Record<string, any> = {};
  if (def?.visual) Object.assign(props, TRANSFORM_DEFAULTS, { x: width / 2, y: height / 2 });
  for (const p of engine.layerProps(type)) if (p.default !== undefined && !(p.key in props)) props[p.key] = p.default;
  if (def?.defaults) Object.assign(props, def.defaults({ project, width, height }));
  Object.assign(props, extra);
  return {
    id: newId('lyr'),
    type,
    name: name || def?.label || type,
    parentId: null,
    visible: true,
    locked: false,
    props,
    effect: null,
  };
}

export function createNode(engine: Engine, project: Project, type: string, chapterId: string, x: number, y: number, name?: string): StoryNode {
  const def = engine.nodeTypes.get(type);
  if (!def) throw new Error(`Unknown node type ${type}`);
  return {
    id: newId(type === 'core.scene' ? 'scn' : 'nod'),
    type,
    chapterId,
    name: name ?? def.label,
    x,
    y,
    data: def.createData(project),
    modules: [],
  };
}

/** Next free scene number in a project, e.g. "12". */
export function nextSceneNumber(project: Project): string {
  let max = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.type !== 'core.scene') continue;
    const v = parseInt((n.data as SceneData).number, 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return String(max + 1);
}

/**
 * The global page: elements on it appear on every page (BGM, HUD, inventory, health
 * bars…) and keep their state between pages; its scripts run on every page. It is a
 * hidden node of type core.global with scene data, so the scene editor edits it.
 */
export const GLOBAL_NODE_ID = 'global';
export const GLOBAL_NODE_TYPE = 'core.global';

export function ensureGlobalNode(p: Project): StoryNode<SceneData> {
  let n = p.nodes[GLOBAL_NODE_ID] as StoryNode<SceneData> | undefined;
  if (!n || n.type !== GLOBAL_NODE_TYPE) {
    n = { id: GLOBAL_NODE_ID, type: GLOBAL_NODE_TYPE, chapterId: '', name: 'Global', x: 0, y: 0, data: { ...createSceneData('G'), background: 'transparent' }, modules: [] };
    p.nodes[GLOBAL_NODE_ID] = n;
  }
  return n;
}

/** Is this node a page with elements (a scene, or the global page)? */
export function hasSceneData(n: StoryNode | undefined | null): n is StoryNode<SceneData> {
  return !!n && (n.type === 'core.scene' || n.type === GLOBAL_NODE_TYPE);
}
