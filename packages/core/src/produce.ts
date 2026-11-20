/**
 * Minimal copy-on-write "produce" (in the spirit of Immer).
 *
 * `produce(base, draft => { draft.a.b = 1 })` returns a new object tree where
 * only the touched path is copied and every other branch is shared with `base`.
 * The base object is never mutated, which makes undo/redo a matter of keeping
 * previous roots, and lets React compare references cheaply.
 */

const DRAFT = Symbol('vne.draft');

interface DraftState {
  base: any;
  copy: any | null;
  parent: DraftState | null;
  key: PropertyKey | null;
  children: Map<PropertyKey, any>;
}

function isDraftable(v: any): boolean {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return Array.isArray(v) || proto === Object.prototype || proto === null;
}

function shallowCopy(v: any): any {
  return Array.isArray(v) ? v.slice() : Object.assign(Object.create(Object.getPrototypeOf(v)), v);
}

function markChanged(state: DraftState): void {
  if (!state.copy) {
    state.copy = shallowCopy(state.base);
    if (state.parent) {
      markChanged(state.parent);
      state.parent.copy[state.key as any] = state.copy;
    }
  }
}

function source(state: DraftState): any {
  return state.copy || state.base;
}

function createDraft(base: any, parent: DraftState | null, key: PropertyKey | null): any {
  const state: DraftState = { base, copy: null, parent, key, children: new Map() };
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === DRAFT) return state;
      const src = source(state);
      const value = src[prop as any];
      if (typeof prop === 'symbol') return value;
      if (state.children.has(prop)) {
        const child = state.children.get(prop);
        // The child may have been replaced by a plain assignment.
        if ((child as any)[DRAFT] && (child as any)[DRAFT].base === value) return child;
        if ((child as any)[DRAFT] && (child as any)[DRAFT].copy === value) return child;
      }
      if (isDraftable(value)) {
        const child = createDraft(value, state, prop);
        state.children.set(prop, child);
        return child;
      }
      if (Array.isArray(src) && typeof value === 'function') {
        return value;
      }
      return value;
    },
    set(_t, prop, value) {
      const src = source(state);
      if (src[prop as any] === value && prop in src) return true;
      markChanged(state);
      state.copy[prop as any] = unwrap(value);
      state.children.delete(prop);
      return true;
    },
    deleteProperty(_t, prop) {
      if (!(prop in source(state))) return true;
      markChanged(state);
      delete state.copy[prop as any];
      state.children.delete(prop);
      return true;
    },
    has(_t, prop) {
      return prop in source(state);
    },
    ownKeys() {
      return Reflect.ownKeys(source(state));
    },
    getOwnPropertyDescriptor(_t, prop) {
      const src = source(state);
      const d = Reflect.getOwnPropertyDescriptor(src, prop);
      if (!d) return d;
      return { ...d, writable: true, configurable: true };
    },
  };
  return new Proxy(Array.isArray(base) ? [] : {}, handler);
}

/** Convert a value that may contain drafts back into plain finalized data. */
function unwrap(value: any, depth = 0): any {
  if (!value || typeof value !== 'object') return value;
  if ((value as any)[DRAFT]) return finalize((value as any)[DRAFT]);
  if (depth > 64 || !isDraftable(value)) return value;
  // A plain container may hold drafts (e.g. the result of draft.list.filter()).
  let out: any = null;
  const keys = Array.isArray(value) ? value.keys() : Object.keys(value);
  for (const k of keys as Iterable<any>) {
    const v = value[k];
    const u = unwrap(v, depth + 1);
    if (u !== v) {
      if (!out) out = shallowCopy(value);
      out[k] = u;
    }
  }
  return out || value;
}

function finalize(state: DraftState): any {
  if (!state.copy) {
    // children may still have been modified
    let changed = false;
    for (const [k, child] of state.children) {
      const cs: DraftState = child[DRAFT];
      if (cs.copy) {
        changed = true;
        break;
      }
      void k;
    }
    if (!changed) return state.base;
  }
  const out = state.copy || shallowCopy(state.base);
  for (const [k, child] of state.children) {
    const cs: DraftState = child[DRAFT];
    if (out[k as any] === cs.base || out[k as any] === cs.copy) out[k as any] = finalize(cs);
  }
  // Values assigned through the proxy are unwrapped in the `set` trap.
  return out;
}

export type Recipe<T> = (draft: T) => void | T;

export function produce<T>(base: T, recipe: Recipe<T>): T {
  if (!isDraftable(base)) {
    const r = recipe(base);
    return (r === undefined ? base : r) as T;
  }
  const draft = createDraft(base, null, null);
  const result = recipe(draft);
  if (result !== undefined && result !== draft) return unwrap(result);
  return finalize(draft[DRAFT]);
}

export function isDraft(v: any): boolean {
  return !!(v && typeof v === 'object' && v[DRAFT]);
}

/** Return the current plain value behind a draft (deep copy of the current state). */
export function current<T>(v: T): T {
  if (!isDraft(v)) return v;
  return JSON.parse(JSON.stringify(v));
}
