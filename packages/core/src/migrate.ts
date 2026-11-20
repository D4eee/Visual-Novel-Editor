import { PROJECT_FORMAT, PROJECT_FORMAT_VERSION, Project } from './types';
import { defaultSettings } from './defaults';

/**
 * Project format migrations. Each entry upgrades a project from `from` to `from + 1`.
 * Migrations must only add or reshape data — they never delete unknown fields.
 */
export const migrations: { from: number; describe: string; run(p: any): void }[] = [
  // Example for the future:
  // { from: 1, describe: 'Split textbox style into themes', run(p) { ... } },
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
  for (const n of Object.values<any>(p.nodes)) {
    if (!Array.isArray(n.modules)) n.modules = [];
    if (!n.chapterId || !p.chapters.some((c: any) => c.id === n.chapterId)) n.chapterId = p.chapters[0].id;
    if (n.type === 'core.scene' && n.data) {
      for (const k of ['layers', 'animations', 'dialogue', 'choices', 'scripts', 'localVariables']) if (!Array.isArray(n.data[k])) n.data[k] = [];
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
