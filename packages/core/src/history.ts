import { produce, Recipe } from './produce';

export interface HistoryEntry<T> {
  state: T;
  label: string;
  time: number;
  mergeKey?: string;
}

export interface UpdateOptions {
  /** Consecutive updates with the same key within `mergeWindow` collapse into one undo step (drags, typing). */
  mergeKey?: string;
  mergeWindow?: number;
  /** Do not create an undo step (e.g. view-state changes). */
  transient?: boolean;
}

/**
 * Snapshot-based undo/redo over immutable state. Because updates are made with
 * copy-on-write `produce`, every snapshot shares unchanged branches with its
 * neighbours, so keeping hundreds of steps costs little memory.
 */
export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private present: T;
  private listeners = new Set<() => void>();
  private savedState: T;
  limit = 300;

  constructor(initial: T) {
    this.present = initial;
    this.savedState = initial;
  }

  get state(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }

  get redoLabel(): string | null {
    return this.future.length ? this.future[this.future.length - 1].label : null;
  }

  get dirty(): boolean {
    return this.present !== this.savedState;
  }

  markSaved(state: T = this.present): void {
    this.savedState = state;
    this.notify();
  }

  update(label: string, recipe: Recipe<T>, opts: UpdateOptions = {}): T {
    const next = produce(this.present, recipe);
    if (next === this.present) return next;
    this.commit(label, next, opts);
    return next;
  }

  /** Replace the state with an already-computed value. */
  commit(label: string, next: T, opts: UpdateOptions = {}): void {
    if (next === this.present) return;
    if (!opts.transient) {
      const last = this.past[this.past.length - 1];
      const now = Date.now();
      const window = opts.mergeWindow ?? 1200;
      if (opts.mergeKey && last && last.mergeKey === opts.mergeKey && now - last.time < window) {
        last.time = now; // keep the original "before" state, extend the window
      } else {
        this.past.push({ state: this.present, label, time: now, mergeKey: opts.mergeKey });
        if (this.past.length > this.limit) this.past.shift();
      }
      this.future = [];
    }
    this.present = next;
    this.notify();
  }

  undo(): string | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ state: this.present, label: entry.label, time: Date.now() });
    this.present = entry.state;
    this.notify();
    return entry.label;
  }

  redo(): string | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ state: this.present, label: entry.label, time: Date.now() });
    this.present = entry.state;
    this.notify();
    return entry.label;
  }

  /** Reset without history, e.g. after loading a file. */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.present = state;
    this.savedState = state;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
