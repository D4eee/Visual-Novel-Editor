import { PROJECT_FORMAT, PROJECT_FORMAT_VERSION, Project } from './types';
import { defaultSettings, TRANSFORM_DEFAULTS, ensureGlobalNode, GLOBAL_NODE_TYPE } from './defaults';
import { CHOICE_STYLE, DIALOGUE_LAYER, CHOICE_LAYER } from './elements';

/**
 * Project format migrations. Each entry upgrades a project from `from` to `from + 1`.
 * Migrations must only add or reshape data — they never delete unknown fields.
 */
export const migrations: { from: number; describe: string; run(p: any): void }[] = [
  {
    // Format 2: dialogue and choices become scene elements. Ids are kept, so
    // choice connections (c:<choice id>), scripts and references stay valid.
    from: 1,
    describe: 'Dialogue and choices became scene elements',
    run(p) {
      const res = p.settings?.resolution || { width: 1280, height: 720 };
      for (const n of Object.values<any>(p.nodes || {})) {
        if (n.type !== 'core.scene' || !n.data) continue;
        const d = n.data;
        if (!Array.isArray(d.layers)) d.layers = [  {
    from: 2,
    describe: 'Game module: global page, items and inventory, list variables',
    run(p) {
      // New fields only; fillDefaults adds the global page, items and inventory.
      if (!Array.isArray(p.items)) p.items = [];
      if (p.inventoryVarId === undefined) p.inventoryVarId = null;
    },
  },
];
        const lines = Array.isArray(d.dialogue) ? d.dialogue : [];
        const choices = Array.isArray(d.choices) ? d.choices : [];
        if (lines.length) d.layers.push({ id: `${n.id}_dialogue`, type: DIALOGUE_LAYER, name: 'Dialogue', parentId: null, visible: true, locked: false, props: { lines } });
        const top = res.height * 0.3, gap = CHOICE_STYLE.height + 16;
        choices.forEach((c: any, i: number) => {
          d.layers.push({
            id: c.id, type: CHOICE_LAYER, name: String(c.text || `Choice ${i + 1}`).slice(0, 40), parentId: null, visible: true, locked: false,
            props: {
              ...TRANSFORM_DEFAULTS, ...CHOICE_STYLE, x: res.width / 2, y: top + i * gap,
              text: c.text || '', condition: c.condition ?? null, hidden: !!c.hidden, unavailable: c.unavailable || 'hide',
              effects: Array.isArray(c.effects) ? c.effects : [], animationId: c.animationId ?? null,
              requiresItem: c.requiresItem ?? null, consumeItem: !!c.consumeItem,
            },
          });
        });
        delete d.dialogue;
        delete d.choices;
      }
    },
  },
  {
    from: 3,
    describe: 'Format 4: parent links (Layer.link) and in/out points, markers and work areas on animations. Nothing to convert.',
    run() { /* new optional fields only */ },
  },
  {
    from: 4,
    describe: 'Format 5: translations (Project.localization), animations inside compositions and track expressions. Nothing to convert.',
    run() { /* new optional fields only; older editors would drop them, so they refuse format 5 */ },
  },
  {
    from: 5,
    describe: 'Format 6: character rigs, motions and expressions, and scene preset groups. Nothing to convert.',
    run() { /* new optional fields only */ },
  },
];

export class ProjectFormatError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export interface LoadResult {
  project: Project;
  migratedFrom: number | null;
  notes: string[];
}

/** Parse, validate the envelope, migrate and fill defaults. Throws ProjectFormatError for files it cannot read. */
export function loadProject(input: string | object): LoadResult {
  let raw: any;
  try {
    raw = typeof input === 'string' ? JSON.parse(input) : JSON.parse(JSON.stringify(input));
  } catch (err: any) {
    throw new ProjectFormatError(`The project file is not valid JSON: ${err?.message || err}`, 'project.invalidJson');
  }
  if (!raw || raw.format !== PROJECT_FORMAT) throw new ProjectFormatError('This file is not a visual novel project.', 'project.notProject');
  const version = Number(raw.formatVersion || 0);
  if (version > PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError(`The project was saved by a newer engine (format ${version}). Please update the editor.`, 'project.tooNew');
  }
  const notes: string[] = [];
  let v = version;
  for (const m of migrations) {
    if (m.from === v) {
      m.run(raw);
      notes.push(m.describe);
      v++;
    }
  }
  raw.formatVersion = PROJECT_FORMAT_VERSION;
  fillDefaults(raw);
  return { project: raw as Project, migratedFrom: version !== PROJECT_FORMAT_VERSION ? version : null, notes };
}

/** Make older or hand-edited files structurally complete without touching existing values. */
export function fillDefaults(p: any): void {
  const d = defaultSettings(p.name || 'Untitled');
  p.settings = deepDefaults(p.settings || {}, d);
  for (const k of ['chapters', 'edges', 'variables', 'characters', 'assets', 'compositions', 'effectGraphs', 'behaviors', 'modules']) {
    if (!Array.isArray(p[k])) p[k] = [];
  }
  if (!p.nodes || typeof p.nodes !== 'object') p.nodes = {};
  if (!p.extensions || typeof p.extensions !== 'object') p.extensions = {};
  if (!p.editor) p.editor = { views: {} };
  if (p.chapters.length === 0) p.chapters.push({ id: 'chp_default', name: 'Chapter 1' });
  if (!Array.isArray(p.items)) p.items = [];
  if (p.inventoryVarId === undefined) p.inventoryVarId = null;
  ensureGlobalNode(p);
  for (const n of Object.values<any>(p.nodes)) {
    if (!Array.isArray(n.modules)) n.modules = [];
    // The global page belongs to no chapter.
    if (n.type === GLOBAL_NODE_TYPE) n.chapterId = '';
    else if (!n.chapterId || !p.chapters.some((c: any) => c.id === n.chapterId)) n.chapterId = p.chapters[0].id;
    if ((n.type === 'core.scene' || n.type === GLOBAL_NODE_TYPE) && n.data) {
      for (const k of ['layers', 'animations', 'scripts', 'localVariables']) if (!Array.isArray(n.data[k])) n.data[k] = [];
      for (const a of n.data.animations) { if (!Array.isArray(a.tracks)) a.tracks = []; if (!Array.isArray(a.media)) a.media = []; }
    }
  }
  for (const a of p.assets) { if (!Array.isArray(a.tags)) a.tags = []; if (!a.meta) a.meta = {}; }
}

function deepDefaults(target: any, defaults: any): any {
  for (const [k, v] of Object.entries(defaults)) {
    if (target[k] === undefined) target[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepDefaults(target[k], v);
  }
  return target;
}

/** Serialise deterministically (stable key order for top-level, 2-space indent) for clean diffs in version control. */
export function serializeProject(project: Project): string {
  return JSON.stringify({ ...project, modified: new Date().toISOString() }, null, 2);
}
