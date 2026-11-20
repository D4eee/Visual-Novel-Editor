import { satisfies, compareVersions } from './util';
import { ENGINE_VERSION, API_VERSION } from './defaults';

/** Standard module manifest (module.json). See docs/modding/manifest.md. */
export interface ModuleManifest {
  /** Reverse-DNS id, e.g. "com.example.inventory". */
  id: string;
  name: string | Record<string, string>;
  version: string;
  description?: string | Record<string, string>;
  author?: { name: string; email?: string; url?: string } | string;
  license?: string;
  homepage?: string;
  /** Engine version range, e.g. ">=0.1.0 <1.0.0". */
  engine: string;
  /** SDK API version range, e.g. "^1.0.0". */
  api?: string;
  dependencies?: Record<string, string>;
  /** Kind of extension: editor-only, runtime-only or both. Derived from entry points when omitted. */
  kind?: 'editor' | 'runtime' | 'combined';
  /** Capabilities the module registers; used for discovery and missing-module diagnostics. */
  provides?: {
    nodes?: string[];
    layers?: string[];
    blocks?: string[];
    effects?: string[];
    components?: string[];
    properties?: string[];
    interpolators?: string[];
    transitions?: string[];
    portTypes?: string[];
    systems?: string[];
    panels?: string[];
    workspaces?: string[];
    importers?: string[];
    exporters?: string[];
  };
  /** Relative path of the runtime entry (ES module). Included in exported games. */
  runtime?: string;
  /** Relative path of the editor entry (ES module). Never exported. */
  editor?: string;
  /** Folder with <locale>.json dictionaries. */
  locales?: string;
  /** Folder with files the runtime needs (copied into exports). */
  assets?: string;
  permissions?: ModulePermission[];
  icon?: string;
}

export type ModulePermission = 'storage' | 'network' | 'clipboard' | 'fullscreen';
export const KNOWN_PERMISSIONS: ModulePermission[] = ['storage', 'network', 'clipboard', 'fullscreen'];

export interface ManifestProblem {
  field: string;
  message: string;
}

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i;

export function validateManifest(m: any): ManifestProblem[] {
  const out: ManifestProblem[] = [];
  if (!m || typeof m !== 'object') return [{ field: '*', message: 'manifest must be a JSON object' }];
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) out.push({ field: 'id', message: 'id must be reverse-DNS style, e.g. "com.example.mymodule"' });
  if (m.id && String(m.id).startsWith('core')) out.push({ field: 'id', message: '"core" ids are reserved' });
  if (!m.name) out.push({ field: 'name', message: 'name is required' });
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) out.push({ field: 'version', message: 'version must be semver x.y.z' });
  if (typeof m.engine !== 'string') out.push({ field: 'engine', message: 'engine version range is required, e.g. ">=0.1.0"' });
  if (!m.runtime && !m.editor) out.push({ field: 'runtime', message: 'at least one of "runtime" or "editor" entry points is required' });
  for (const p of m.permissions || []) if (!KNOWN_PERMISSIONS.includes(p)) out.push({ field: 'permissions', message: `unknown permission "${p}"` });
  if (m.dependencies && typeof m.dependencies !== 'object') out.push({ field: 'dependencies', message: 'dependencies must be an object of id → version range' });
  return out;
}

export function moduleKind(m: ModuleManifest): 'editor' | 'runtime' | 'combined' {
  if (m.kind) return m.kind;
  if (m.runtime && m.editor) return 'combined';
  return m.runtime ? 'runtime' : 'editor';
}

export interface CompatResult {
  ok: boolean;
  reasons: string[];
}

export function checkCompatibility(m: ModuleManifest, engineVersion = ENGINE_VERSION, apiVersion = API_VERSION): CompatResult {
  const reasons: string[] = [];
  if (m.engine && !satisfies(engineVersion, m.engine)) reasons.push(`requires engine ${m.engine}, this is ${engineVersion}`);
  if (m.api && !satisfies(apiVersion, m.api)) reasons.push(`requires SDK API ${m.api}, this is ${apiVersion}`);
  return { ok: reasons.length === 0, reasons };
}

export interface ResolvedModule<T = unknown> {
  manifest: ModuleManifest;
  payload: T;
}

export interface DependencyProblem {
  moduleId: string;
  kind: 'missing' | 'version' | 'cycle';
  dependency?: string;
  detail: string;
}

/**
 * Order modules so dependencies activate first, and report missing / incompatible
 * dependencies and cycles. Modules with problems are excluded from `order`.
 */
export function resolveDependencies<T>(mods: ResolvedModule<T>[]): { order: ResolvedModule<T>[]; problems: DependencyProblem[] } {
  const byId = new Map(mods.map((m) => [m.manifest.id, m]));
  const problems: DependencyProblem[] = [];
  const bad = new Set<string>();
  for (const m of mods) {
    for (const [dep, range] of Object.entries(m.manifest.dependencies || {})) {
      const d = byId.get(dep);
      if (!d) { problems.push({ moduleId: m.manifest.id, kind: 'missing', dependency: dep, detail: `needs ${dep} ${range}` }); bad.add(m.manifest.id); }
      else if (!satisfies(d.manifest.version, range)) { problems.push({ moduleId: m.manifest.id, kind: 'version', dependency: dep, detail: `needs ${dep} ${range}, found ${d.manifest.version}` }); bad.add(m.manifest.id); }
    }
  }
  // Propagate: modules depending on bad modules are bad too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of mods) {
      if (bad.has(m.manifest.id)) continue;
      if (Object.keys(m.manifest.dependencies || {}).some((d) => bad.has(d))) { bad.add(m.manifest.id); changed = true; problems.push({ moduleId: m.manifest.id, kind: 'missing', detail: 'a dependency failed to load' }); }
    }
  }
  const order: ResolvedModule<T>[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (m: ResolvedModule<T>, stack: string[]) => {
    const id = m.manifest.id;
    if (bad.has(id) || state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') { problems.push({ moduleId: id, kind: 'cycle', detail: `dependency cycle: ${[...stack, id].join(' → ')}` }); bad.add(id); return; }
    state.set(id, 'visiting');
    for (const dep of Object.keys(m.manifest.dependencies || {})) { const d = byId.get(dep); if (d) visit(d, [...stack, id]); }
    state.set(id, 'done');
    if (!bad.has(id)) order.push(m);
  };
  for (const m of [...mods].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) visit(m, []);
  return { order, problems };
}

export function newestFirst(a: ModuleManifest, b: ModuleManifest): number {
  return compareVersions(b.version, a.version);
}
