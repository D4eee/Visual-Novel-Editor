import type { Engine, ModuleManifest, Dictionary, I18n, Registry } from '@vne/core';
import { checkCompatibility, resolveDependencies, ENGINE_VERSION, API_VERSION, validateManifest } from '@vne/core';

export interface ModuleSource {
  manifest: ModuleManifest;
  /** URL of the module folder, ending with "/". */
  baseUrl: string;
  /** Dictionaries keyed by locale (pre-read by the host or embedded at export). */
  locales?: Record<string, Dictionary>;
  enabled?: boolean;
}

export type ModuleStatus = 'active' | 'failed' | 'disabled' | 'incompatible' | 'dependency' | 'faulted' | 'invalid';

export interface ModuleRecord {
  manifest: ModuleManifest;
  source: ModuleSource;
  status: ModuleStatus;
  error?: string;
  problems: string[];
  errorCount: number;
  exports?: any;
  /** Cleanup returned by activate(). */
  deactivate?: () => void;
}

export interface ModuleHostOptions {
  mode: 'editor' | 'preview' | 'game';
  onError?: (moduleId: string, err: unknown, where: string) => void;
  /** Maximum errors before a module is switched off for the session. */
  faultLimit?: number;
}

/**
 * Loads runtime entry points of modules and activates them with a scoped API.
 * Every function a module registers is wrapped so an exception is reported
 * with the module's id instead of breaking the editor or the game.
 */
export class ModuleHost {
  readonly records = new Map<string, ModuleRecord>();

  constructor(readonly engine: Engine, readonly i18n: I18n, readonly opts: ModuleHostOptions) {}

  report(rec: ModuleRecord, err: unknown, where: string): void {
    rec.errorCount++;
    this.opts.onError?.(rec.manifest.id, err, where);
    if (rec.errorCount >= (this.opts.faultLimit ?? 50) && rec.status === 'active') {
      rec.status = 'faulted';
      rec.error = `Switched off after ${rec.errorCount} errors. Last: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async loadAll(sources: ModuleSource[]): Promise<ModuleRecord[]> {
    const usable: { manifest: ModuleManifest; payload: ModuleSource }[] = [];
    for (const s of sources) {
      const rec: ModuleRecord = { manifest: s.manifest, source: s, status: 'disabled', problems: [], errorCount: 0 };
      this.records.set(s.manifest.id, rec);
      const mp = validateManifest(s.manifest);
      if (mp.length) { rec.status = 'invalid'; rec.problems = mp.map((p) => `${p.field}: ${p.message}`); rec.error = rec.problems.join('; '); continue; }
      if (s.enabled === false) { rec.status = 'disabled'; continue; }
      const compat = checkCompatibility(s.manifest, ENGINE_VERSION, API_VERSION);
      if (!compat.ok) { rec.status = 'incompatible'; rec.problems = compat.reasons; rec.error = compat.reasons.join('; '); continue; }
      usable.push({ manifest: s.manifest, payload: s });
    }
    const { order, problems } = resolveDependencies(usable);
    for (const p of problems) {
      const rec = this.records.get(p.moduleId);
      if (rec) { rec.status = 'dependency'; rec.problems.push(p.detail); rec.error = rec.problems.join('; '); }
    }
    for (const m of order) await this.activate(this.records.get(m.manifest.id)!);
    return [...this.records.values()];
  }

  private async activate(rec: ModuleRecord): Promise<void> {
    const { manifest, source } = rec;
    for (const [loc, dict] of Object.entries(source.locales || {})) this.i18n.add(loc, dict);
    if (!manifest.runtime) { rec.status = 'active'; return; }
    try {
      const url = new URL(manifest.runtime, source.baseUrl).href;
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ url);
      rec.exports = mod;
      const activate = mod.activate || mod.default?.activate || (typeof mod.default === 'function' ? mod.default : null);
      if (typeof activate !== 'function') throw new Error('runtime entry must export "activate(api)" or a default module object');
      const api = this.createApi(rec);
      const r = await activate(api);
      if (typeof r === 'function') rec.deactivate = r;
      rec.status = 'active';
    } catch (err: any) {
      this.engine.unregisterOwner(manifest.id);
      rec.status = 'failed';
      rec.error = err?.message || String(err);
      this.opts.onError?.(manifest.id, err, 'activate');
    }
  }

  deactivate(id: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
    try { rec.deactivate?.(); } catch (err) { this.opts.onError?.(id, err, 'deactivate'); }
    this.engine.unregisterOwner(id);
    rec.status = 'disabled';
  }

  /** The runtime API given to `activate(api)`. Documented in docs/api/runtime-api.md. */
  createApi(rec: ModuleRecord): any {
    const id = rec.manifest.id;
    const host = this;
    const qualify = (local: string): string => {
      if (typeof local !== 'string' || !local) throw new Error('definitions need a string id');
      if (local.includes('/')) {
        if (!local.startsWith(`${id}/`)) throw new Error(`id "${local}" must start with "${id}/"`);
        return local;
      }
      return `${id}/${local}`;
    };
    const guard = (fn: any, where: string, rethrow: boolean) => {
      if (typeof fn !== 'function') return fn;
      return function (this: any, ...args: any[]) {
        if (rec.status === 'faulted') { if (rethrow) throw new Error(`Module ${id} was switched off after repeated errors`); return undefined; }
        try {
          const r = fn.apply(this, args);
          if (r && typeof r.then === 'function') return r.catch((err: unknown) => { host.report(rec, err, where); if (rethrow) throw err; });
          return r;
        } catch (err) {
          host.report(rec, err, where);
          if (rethrow) throw err;
          return undefined;
        }
      };
    };
    const wrap = (def: any, kind: string, rethrowKeys: string[] = []) => {
      const out: any = { ...def };
      for (const k of Object.keys(def)) if (typeof def[k] === 'function') out[k] = guard(def[k], `${kind}.${k}`, rethrowKeys.includes(k));
      return out;
    };
    const registrar = <T extends { id: string }>(registry: Registry<any>, kind: string, rethrow: string[] = [], qualifyId = true) => ({
      register(def: T) {
        const full = { ...wrap(def, kind, rethrow), id: qualifyId ? qualify(def.id) : def.id };
        return registry.register(full, id);
      },
      unregister(localId: string) { registry.unregister(qualifyId ? qualify(localId) : localId); },
      get: (anyId: string) => registry.get(anyId),
      list: () => registry.list(),
    });
    const e = this.engine;
    const storageOk = (rec.manifest.permissions || []).includes('storage');
    return Object.freeze({
      id,
      manifest: rec.manifest,
      apiVersion: API_VERSION,
      engineVersion: ENGINE_VERSION,
      mode: this.opts.mode,
      nodes: registrar(e.nodeTypes, 'node', ['run', 'evaluate']),
      ports: registrar(e.portTypes, 'port'),
      layers: registrar(e.layerTypes, 'layer'),
      properties: registrar(e.properties, 'property'),
      interpolators: registrar(e.interpolators, 'interpolator'),
      blocks: registrar(e.blocks, 'block', ['run']),
      effects: registrar(e.effectNodes, 'effect'),
      transitions: registrar(e.transitions, 'transition'),
      components: registrar(e.components, 'component'),
      systems: registrar(e.systems, 'system', ['create']),
      functions: registrar(e.functions, 'function'),
      i18n: {
        t: (key: string, params?: any) => host.i18n.t(key, params),
        add: (locale: string, dict: Dictionary) => host.i18n.add(locale, dict),
        get locale() { return host.i18n.locale; },
      },
      assetUrl: (path: string) => new URL(path.replace(/^\/+/, ''), rec.source.baseUrl).href,
      log: {
        info: (...a: any[]) => console.info(`[${id}]`, ...a),
        warn: (...a: any[]) => console.warn(`[${id}]`, ...a),
        error: (...a: any[]) => { console.error(`[${id}]`, ...a); host.report(rec, new Error(a.map(String).join(' ')), 'log'); },
      },
      storage: storageOk ? {
        get(key: string) { try { const v = localStorage.getItem(`vne-mod:${id}:${key}`); return v === null ? null : JSON.parse(v); } catch { return null; } },
        set(key: string, value: unknown) { try { localStorage.setItem(`vne-mod:${id}:${key}`, JSON.stringify(value)); } catch { /* quota */ } },
        remove(key: string) { try { localStorage.removeItem(`vne-mod:${id}:${key}`); } catch { /* ignore */ } },
      } : null,
    });
  }
}
