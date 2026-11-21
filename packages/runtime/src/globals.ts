import type { Layer, LayerInstance, Project, SceneData } from '@vne/core';
import { GLOBAL_NODE_ID, findItem, toList } from '@vne/core';
import type { GameRuntime } from './game';

/**
 * The global page while the game plays: its elements exist once for the whole game
 * (their state carries from page to page) and are drawn on every page. Labels shown
 * by global scripts live here too.
 */
export class GlobalPage {
  readonly layerState = new Map<string, Record<string, any>>();
  readonly visibleState = new Map<string, boolean>();
  readonly instances = new Map<string, LayerInstance>();
  /** Labels created by global scripts ("show text … as label"). */
  readonly labels: Layer[] = [];
  readonly labelValues = new Map<string, () => string>();
  private started = false;

  constructor(private rt: GameRuntime) {}

  get data(): SceneData | null {
    const n = this.rt.project.nodes[GLOBAL_NODE_ID];
    return n ? (n.data as SceneData) : null;
  }

  get layers(): Layer[] {
    return this.data?.layers || [];
  }

  /** Create state and instances the first time a page plays (and after a reset). */
  ensure(): void {
    if (this.started) return;
    this.started = true;
    for (const l of this.layers) {
      if (!this.layerState.has(l.id)) this.layerState.set(l.id, { ...paramDefaults(l), ...l.props });
      if (!this.visibleState.has(l.id)) this.visibleState.set(l.id, l.visible);
    }
    const lrt = { assets: this.rt.assets, audio: this.rt.audio, mode: 'play' as const, emit: (e: any) => this.rt.scene?.dispatch(e), requestRender: () => {} };
    for (const l of this.layers) {
      const def = this.rt.engine.layerTypes.get(l.type);
      if (!def?.createInstance) continue;
      try { const inst = def.createInstance(l, lrt); if (inst) this.instances.set(l.id, inst); }
      catch (err) { this.rt.reportError(`layer:${l.type}`, err, { nodeId: GLOBAL_NODE_ID, layerId: l.id }); }
    }
    for (const l of this.layers) {
      const p = this.layerState.get(l.id)!;
      if ((l.type === 'core.audio' || l.type === 'core.video') && p.autoplay && this.visibleState.get(l.id) !== false) this.instances.get(l.id)?.play?.(0);
    }
  }

  /** New game / back to title: forget everything. */
  reset(): void {
    for (const [id, inst] of this.instances) { try { inst.stop?.(); inst.dispose?.(); } catch (err) { this.rt.reportError('layer', err, { layerId: id }); } }
    this.instances.clear();
    this.layerState.clear();
    this.visibleState.clear();
    this.labels.length = 0;
    this.labelValues.clear();
    this.started = false;
  }

  snapshot(): { state: Record<string, Record<string, any>>; visible: Record<string, boolean> } {
    return { state: Object.fromEntries(this.layerState), visible: Object.fromEntries(this.visibleState) };
  }

  restore(s: { state?: Record<string, Record<string, any>>; visible?: Record<string, boolean> } | undefined): void {
    this.reset();
    for (const [id, st] of Object.entries(s?.state || {})) if (this.layers.some((l) => l.id === id)) this.layerState.set(id, { ...st });
    for (const [id, v] of Object.entries(s?.visible || {})) if (this.layers.some((l) => l.id === id)) this.visibleState.set(id, v);
  }
}

/** Initial values of an element's custom parameters (props["param.<id>"]). */
export function paramDefaults(l: Layer): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of l.params || []) out[`param.${p.id}`] = p.initial;
  return out;
}

/** Find a parameter of an element by id or name. */
export function findParam(l: Layer | undefined, key: unknown) {
  if (!l || key === null || key === undefined) return undefined;
  const k = String(key);
  return (l.params || []).find((p) => p.id === k) || (l.params || []).find((p) => p.name.toLowerCase() === k.toLowerCase());
}

const FALLBACK_INVENTORY = '__inventory';

/**
 * The player's collectibles. The inventory is a list variable of item names
 * (project.inventoryVarId), so it is saved with the game like every variable.
 */
export class Items {
  /** Name of the item the player picked in an inventory (to use it on something). */
  selected: string | null = null;
  /** Elements already picked up: "nodeId:layerId" (they stay gone when the page is visited again). */
  readonly collected = new Set<string>();

  constructor(private rt: GameRuntime) {}

  private get project(): Project { return this.rt.project; }

  /** The variable holding the inventory (or another list variable). */
  varId(listVar: string | null = null): string {
    return listVar || this.project.inventoryVarId || FALLBACK_INVENTORY;
  }

  list(listVar: string | null = null): string[] {
    return toList(this.rt.vars.get(this.varId(listVar)) ?? []).map(String);
  }

  /** Canonical name of an item (id or any capitalisation → the item's name). */
  nameOf(key: unknown): string {
    const it = findItem(this.project, key);
    return it ? it.name : String(key ?? '').trim();
  }

  count(key: unknown): number {
    const n = this.nameOf(key).toLowerCase();
    return n ? this.list().filter((x) => x.toLowerCase() === n).length : 0;
  }

  has(key: unknown): boolean {
    return this.count(key) > 0;
  }

  add(key: unknown, amount = 1): void {
    const name = this.nameOf(key);
    const n = Math.floor(Number(amount));
    if (!name || !(n >= 1)) return;
    const list = this.list();
    for (let i = 0; i < n; i++) list.push(name);
    this.rt.vars.set(this.varId(), list);
    this.rt.scene?.dispatch({ type: 'item.collected', item: name, itemId: findItem(this.project, name)?.id ?? null });
  }

  /** Remove some (default one, or all) of an item. */
  remove(key: unknown, all = false, amount = 1): void {
    const name = this.nameOf(key).toLowerCase();
    const list = this.list();
    let left = all ? Infinity : Math.max(1, Math.floor(Number(amount) || 1));
    const next = list.filter((x) => (left > 0 && x.toLowerCase() === name ? (left--, false) : true));
    if (next.length === list.length) return;
    this.rt.vars.set(this.varId(), next);
    if (this.selected && !this.has(this.selected)) this.selected = null;
    this.rt.scene?.dispatch({ type: 'item.removed', item: this.nameOf(key), itemId: findItem(this.project, key)?.id ?? null });
  }

  select(key: unknown | null): void {
    const name = key === null || key === undefined || key === '' ? null : this.nameOf(key);
    if (name === this.selected) return;
    this.selected = name;
    this.rt.scene?.dispatch({ type: 'item.selected', item: name ?? '', itemId: name ? findItem(this.project, name)?.id ?? null : null });
  }

  reset(): void {
    this.selected = null;
    this.collected.clear();
  }
}
