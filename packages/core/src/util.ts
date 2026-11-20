/** Stable id generation, semver helpers and small utilities with no DOM dependency. */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(n: number): string {
  let out = '';
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(n);
    g.crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += ALPHABET[buf[i] % 36];
    return out;
  }
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(Math.random() * 36)];
  return out;
}

/** Creates a stable, collision-resistant id such as `scn_k3j9x0aa21pq`. */
export function newId(prefix = 'id'): string {
  return `${prefix}_${randomChars(12)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function deepClone<T>(v: T): T {
  if (typeof (globalThis as any).structuredClone === 'function') return (globalThis as any).structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

/** Replace every id in a subtree with a fresh one, returning the old→new map. Used for duplicate/paste. */
export function remapIds<T>(value: T, idKeys = ['id']): { value: T; map: Map<string, string> } {
  const map = new Map<string, string>();
  const collect = (v: any) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (idKeys.includes(k) && typeof v[k] === 'string' && !map.has(v[k])) {
          const prefix = v[k].includes('_') ? v[k].split('_')[0] : 'id';
          map.set(v[k], newId(prefix));
        }
        collect(v[k]);
      }
    }
  };
  collect(value);
  const rewrite = (v: any): any => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = rewrite(v[k]);
      return o;
    }
    if (typeof v === 'string' && map.has(v)) return map.get(v);
    return v;
  };
  return { value: rewrite(value), map };
}

/* ------------------------------------------------------------------ */
/* Semver (subset: x.y.z, ^, ~, >=, <=, >, <, =, *, space-separated AND, || OR) */
/* ------------------------------------------------------------------ */

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v || '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) || [0, 0, 0];
  const pb = parseVersion(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

function satisfiesComparator(version: string, comp: string): boolean {
  comp = comp.trim();
  if (!comp || comp === '*' || comp === 'x') return true;
  const v = parseVersion(version);
  if (!v) return false;
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(comp);
  if (!m) return false;
  const op = m[1] || '=';
  const target = m[2];
  const t = parseVersion(target);
  if (!t) return false;
  const c = compareVersions(version, target);
  switch (op) {
    case '=': {
      // "1" or "1.2" behave like ranges when parts are omitted
      const parts = target.split('.').length;
      if (parts === 1) return v[0] === t[0];
      if (parts === 2) return v[0] === t[0] && v[1] === t[1];
      return c === 0;
    }
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '~': return c >= 0 && v[0] === t[0] && v[1] === t[1];
    case '^':
      if (c < 0) return false;
      if (t[0] > 0) return v[0] === t[0];
      if (t[1] > 0) return v[0] === 0 && v[1] === t[1];
      return v[0] === 0 && v[1] === 0 && v[2] === t[2];
  }
  return false;
}

export function satisfies(version: string, range: string): boolean {
  if (!range || range.trim() === '' || range.trim() === '*') return true;
  return range.split('||').some((alt) =>
    alt
      .trim()
      .split(/\s+(?=[\^~><=\d])/)
      .filter(Boolean)
      .every((c) => satisfiesComparator(version, c)),
  );
}

/* ------------------------------------------------------------------ */
/* Simple event emitter                                                */
/* ------------------------------------------------------------------ */

export type Listener<T = any> = (payload: T) => void;

export class Emitter<Events extends Record<string, any> = Record<string, any>> {
  private map = new Map<string, Set<Listener>>();
  on<K extends keyof Events & string>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(event);
    if (!set) this.map.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[vne] listener for "${event}" failed`, err);
      }
    }
  }
  clear(): void {
    this.map.clear();
  }
}

export function sortBy<T>(arr: T[], key: (t: T) => number | string): T[] {
  return [...arr].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function formatString(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
