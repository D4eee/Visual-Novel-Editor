import type { Block, BlockDef, Engine, Expr, Project, ScriptStack, VarValue } from '@vne/core';
import { evaluate, isExpr, isBlockRef, builtinFunctions } from '@vne/core';
import type { VarStore } from './state';

export interface RuntimeEvent { type: string; [k: string]: any }

/** Services the script engine needs. Implemented by the scene player and by the story executor. */
export interface ScriptHost {
  engine: Engine;
  project: Project;
  vars: VarStore;
  /** Current scene API, or null when running outside a scene (rare). */
  scene: any | null;
  /** Expression functions (defaults to the engine's table). The game adds has(), etc. */
  functions?: Record<string, import('@vne/core').ExprFunction>;
  /** Game runtime (public API for modules). */
  runtime: any;
  /** Wait respecting pause/skip. */
  sleep(seconds: number, signal: CancelToken): Promise<void>;
  nextFrame(signal: CancelToken): Promise<void>;
  emit(event: RuntimeEvent): void;
  reportError(source: string, err: unknown, extra?: Record<string, any>): void;
  /** Called before each block runs (editor test runs highlight running blocks). */
  trace?(blockId: string): void;
}

export class CancelToken {
  cancelled = false;
  private fns = new Set<() => void>();
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const f of this.fns) f();
    this.fns.clear();
  }
  onCancel(fn: () => void): () => void {
    if (this.cancelled) { fn(); return () => {}; }
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

export class StopThread extends Error {
  constructor() { super('stop'); }
}

/**
 * Context object given to block implementations (`BlockDef.run`). This is part
 * of the public SDK surface — see docs/api/script-context.md.
 */
export class ScriptContext {
  constructor(readonly host: ScriptHost, readonly token: CancelToken, readonly stackId: string, readonly event: RuntimeEvent | null) {}

  get engine() { return this.host.engine; }
  get project() { return this.host.project; }
  get vars() { return this.host.vars; }
  get scene() { return this.host.scene; }
  get runtime() { return this.host.runtime; }
  get cancelled() { return this.token.cancelled; }

  evaluate(v: any): VarValue {
    if (isBlockRef(v)) return reportBlock(this, v.block);
    if (isExpr(v)) return evaluate(v as Expr, this.host.vars, this.host.functions || this.host.engine.functionTable(builtinFunctions));
    return v as VarValue;
  }

  async wait(seconds: number): Promise<void> {
    this.check();
    await this.host.sleep(Math.max(0, Number(seconds) || 0), this.token);
    this.check();
  }

  async waitUntil(cond: () => boolean, timeout = Infinity): Promise<void> {
    const t0 = performance.now();
    while (!cond()) {
      this.check();
      if (performance.now() - t0 > timeout * 1000) return;
      await this.host.nextFrame(this.token);
    }
  }

  async runBody(blocks: Block[] | undefined): Promise<void> {
    await runBlocks(this, blocks || []);
  }

  emit(event: RuntimeEvent): void {
    this.host.emit(event);
  }

  stop(): never {
    throw new StopThread();
  }

  check(): void {
    if (this.token.cancelled) throw new StopThread();
  }
}

/** Value of a reporter/boolean block placed in a slot. Unknown or failing reporters give 0 / false and report the error. */
export function reportBlock(ctx: ScriptContext, block: Block): VarValue {
  const def = ctx.engine.blocks.get(block.type);
  if (!def?.report) {
    ctx.host.reportError('script', new Error(def ? `Block "${block.type}" has no value` : `Unknown block "${block.type}" (is its module installed?)`), { blockId: block.id });
    return 0;
  }
  ctx.host.trace?.(block.id);
  try {
    const v = def.report(ctx, evaluateArgs(ctx, def, block), block);
    return def.shape === 'boolean' ? !!v : (v ?? 0);
  } catch (err) {
    if (err instanceof StopThread) throw err;
    ctx.host.reportError(def.owner && def.owner !== 'core' ? `module:${def.owner}` : 'script', err, { blockId: block.id, block: block.type });
    return def.shape === 'boolean' ? false : 0;
  }
}

export function evaluateArgs(ctx: ScriptContext, def: BlockDef, block: Block): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of def.args) {
    let v = block.args?.[a.id];
    if (v === undefined || v === null) v = a.default ?? null;
    out[a.id] = isBlockRef(v) ? reportBlock(ctx, v.block) : a.type === 'expr' || isExpr(v) ? (v === null ? null : ctx.evaluate(v)) : v;
    if (a.type === 'number' && out[a.id] !== null) out[a.id] = Number(out[a.id]) || 0;
    if (a.type === 'boolean') out[a.id] = out[a.id] === true || out[a.id] === 'true' || out[a.id] === 1;
  }
  return out;
}

export async function runBlocks(ctx: ScriptContext, blocks: Block[]): Promise<void> {
  for (const b of blocks) {
    ctx.check();
    const def = ctx.engine.blocks.get(b.type);
    if (!def) {
      ctx.host.reportError('script', new Error(`Unknown block "${b.type}" (is its module installed?)`), { blockId: b.id });
      continue;
    }
    if (!def.run) continue;
    ctx.host.trace?.(b.id);
    try {
      await def.run(ctx, evaluateArgs(ctx, def, b), b);
    } catch (err) {
      if (err instanceof StopThread) throw err;
      ctx.host.reportError(def.owner && def.owner !== 'core' ? `module:${def.owner}` : 'script', err, { blockId: b.id, block: b.type });
    }
  }
}

/**
 * Event-driven script runner. Each hat block whose event matches spawns a
 * thread; threads run concurrently (cooperatively) and are cancelled when the
 * scene ends.
 */
export class ScriptEngine {
  private threads = new Set<CancelToken>();
  private threadStacks = new Map<CancelToken, string>();
  /** Stacks that must not react to an event (carried scripts do not restart on "page starts"). */
  skip: ((stack: ScriptStack, event: RuntimeEvent) => boolean) | null = null;
  private teardown: (() => void)[] = [];
  private stopped = false;
  /** Number of hat stacks that handled the last dispatched event. */
  lastHandled = 0;

  constructor(private host: ScriptHost, private stacks: () => ScriptStack[]) {}

  /** Start timer-style hats. Call once when the scene starts. */
  start(): void {
    for (const s of this.stacks()) this.setupStack(s);
  }

  private stackTeardown = new Map<string, () => void>();

  /** Start a timer-style hat (every n seconds, when the mouse enters…). Returns false for other hats. */
  setupStack(s: ScriptStack): boolean {
    if (!s.enabled || this.stopped) return false;
    const def = this.host.engine.blocks.get(s.hat.type);
    const setup = (def as any)?.setup as ((ctx: ScriptContext, args: any, fire: () => void) => (() => void) | void) | undefined;
    if (!setup) return false;
    if (this.stackTeardown.has(s.id)) return true;
    const ctx = new ScriptContext(this.host, new CancelToken(), s.id, null);
    try {
      const stop = setup(ctx, evaluateArgs(ctx, def!, s.hat), () => { if (this.stacks().some((x) => x.id === s.id)) this.spawn(s, null); });
      if (stop) { this.teardown.push(stop); this.stackTeardown.set(s.id, stop); }
      else this.stackTeardown.set(s.id, () => {});
    } catch (err) {
      this.host.reportError('script', err, { stackId: s.id });
    }
    return true;
  }

  /** Has a timer-style hat that runs on its own? */
  hasSetup(s: ScriptStack): boolean {
    return !!(this.host.engine.blocks.get(s.hat?.type) as any)?.setup;
  }

  /** Stop every thread of one stack (and its timer hat). */
  stopStack(stackId: string): void {
    for (const [t, id] of this.threadStacks) if (id === stackId) { t.cancel(); this.threads.delete(t); this.threadStacks.delete(t); }
    const td = this.stackTeardown.get(stackId);
    if (td) { try { td(); } catch { /* ignore */ } this.stackTeardown.delete(stackId); }
  }

  /** Stacks that have a thread running now. */
  runningStacks(): Set<string> {
    return new Set(this.threadStacks.values());
  }

  dispatch(event: RuntimeEvent): number {
    if (this.stopped) return 0;
    let handled = 0;
    for (const s of this.stacks()) {
      if (!s.enabled) continue;
      const def = this.host.engine.blocks.get(s.hat.type);
      if (!def || def.shape !== 'hat' || def.event !== event.type) continue;
      if (this.skip?.(s, event)) continue;
      const probe = new ScriptContext(this.host, new CancelToken(), s.id, event);
      let ok = false;
      try { ok = def.matches ? def.matches(event, evaluateArgs(probe, def, s.hat)) : true; }
      catch (err) { this.host.reportError('script', err, { stackId: s.id }); }
      if (!ok) continue;
      handled++;
      this.spawn(s, event);
    }
    this.lastHandled = handled;
    return handled;
  }

  /** True if some enabled stack listens for this event type (+ optional predicate on args). */
  listens(type: string, predicate?: (args: Record<string, any>) => boolean): boolean {
    for (const s of this.stacks()) {
      if (!s.enabled) continue;
      const def = this.host.engine.blocks.get(s.hat.type);
      if (!def || def.event !== type) continue;
      if (!predicate) return true;
      const probe = new ScriptContext(this.host, new CancelToken(), s.id, null);
      try { if (predicate(evaluateArgs(probe, def, s.hat))) return true; } catch { /* ignore */ }
    }
    return false;
  }

  spawn(stack: ScriptStack, event: RuntimeEvent | null): Promise<void> {
    const token = new CancelToken();
    if (this.stopped) return Promise.resolve();
    this.threads.add(token);
    this.threadStacks.set(token, stack.id);
    const ctx = new ScriptContext(this.host, token, stack.id, event);
    if (stack.hat) this.host.trace?.(stack.hat.id);
    return runBlocks(ctx, stack.body)
      .catch((err) => { if (!(err instanceof StopThread)) this.host.reportError('script', err, { stackId: stack.id }); })
      .finally(() => { this.threads.delete(token); this.threadStacks.delete(token); });
  }

  /** Run a list of blocks once (event nodes, behaviors). */
  async runOnce(blocks: Block[], id = 'inline'): Promise<void> {
    const token = new CancelToken();
    this.threads.add(token);
    try {
      await runBlocks(new ScriptContext(this.host, token, id, null), blocks);
    } catch (err) {
      if (!(err instanceof StopThread)) this.host.reportError('script', err);
    } finally {
      this.threads.delete(token);
    }
  }

  get activeThreads(): number {
    return this.threads.size;
  }

  stopAll(): void {
    this.stopped = true;
    for (const t of this.threads) t.cancel();
    this.threads.clear();
    this.threadStacks.clear();
    this.stackTeardown.clear();
    for (const fn of this.teardown) try { fn(); } catch { /* ignore */ }
    this.teardown = [];
  }
}
