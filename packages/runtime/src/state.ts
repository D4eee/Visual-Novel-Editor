import type { Project, VarValue, VariableDef, VarScope } from '@vne/core';
import { coerce, Emitter } from '@vne/core';

export interface VarChange { id: string; value: VarValue; previous: VarValue | undefined; name: string }

/**
 * Variable storage with three scopes:
 * - game: saved with the player's progress
 * - persistent: shared by every save slot (endings unlocked, gallery...)
 * - scene: local to the scene that is currently playing
 */
export class VarStore implements VarScope {
  private game = new Map<string, VarValue>();
  private persistent = new Map<string, VarValue>();
  private local = new Map<string, VarValue>();
  private localDefs = new Map<string, VariableDef>();
  readonly events = new Emitter<{ change: VarChange }>();

  constructor(private project: () => Project, private persistKey: string | null = null) {
    this.reset();
    this.loadPersistent();
  }

  defs(): VariableDef[] {
    return [...this.project().variables, ...this.localDefs.values()];
  }

  def(id: string): VariableDef | undefined {
    return this.project().variables.find((v) => v.id === id) || this.localDefs.get(id);
  }

  byName(name: string): VariableDef | undefined {
    return this.defs().find((v) => v.name === name);
  }

  reset(): void {
    this.game.clear();
    for (const v of this.project().variables) if (v.scope !== 'persistent') this.game.set(v.id, v.initial);
  }

  get(id: string): VarValue | undefined {
    if (this.local.has(id)) return this.local.get(id);
    if (this.game.has(id)) return this.game.get(id);
    if (this.persistent.has(id)) return this.persistent.get(id);
    const d = this.def(id);
    return d ? d.initial : undefined;
  }

  set(id: string, value: VarValue): void {
    const d = this.def(id);
    const v = d ? coerce(d.type, value) : value;
    const prev = this.get(id);
    if (this.localDefs.has(id)) this.local.set(id, v);
    else if (d?.scope === 'persistent') { this.persistent.set(id, v); this.savePersistent(); }
    else this.game.set(id, v);
    if (prev !== v) this.events.emit('change', { id, value: v, previous: prev, name: d?.name || id });
  }

  enterScene(defs: VariableDef[]): void {
    this.local.clear();
    this.localDefs.clear();
    for (const d of defs) { this.localDefs.set(d.id, d); this.local.set(d.id, d.initial); }
  }

  exitScene(): void {
    this.local.clear();
    this.localDefs.clear();
  }

  snapshot(): Record<string, VarValue> {
    return Object.fromEntries(this.game);
  }

  restore(values: Record<string, VarValue>): void {
    this.reset();
    for (const [k, v] of Object.entries(values || {})) this.game.set(k, v);
  }

  /** All current values (for the debugger). */
  all(): { def: VariableDef; value: VarValue | undefined; scope: string }[] {
    return this.defs().map((def) => ({ def, value: this.get(def.id), scope: this.localDefs.has(def.id) ? 'scene' : def.scope }));
  }

  private loadPersistent(): void {
    for (const v of this.project().variables) if (v.scope === 'persistent') this.persistent.set(v.id, v.initial);
    if (!this.persistKey) return;
    try {
      const raw = globalThis.localStorage?.getItem(this.persistKey);
      if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) this.persistent.set(k, v as VarValue);
    } catch { /* storage unavailable */ }
  }

  private savePersistent(): void {
    if (!this.persistKey) return;
    try { globalThis.localStorage?.setItem(this.persistKey, JSON.stringify(Object.fromEntries(this.persistent))); } catch { /* ignore */ }
  }
}
