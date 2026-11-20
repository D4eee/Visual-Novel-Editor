import type { Block, BlockDef, Engine, Expr, Project, ScriptStack, VarValue } from '@vne/core';
import { evaluate, isExpr, builtinFunctions } from '@vne/core';
import type { VarStore } from './state';

export interface RuntimeEvent { type: string; [k: string]: any }

/** Services the script engine needs. Implemented by the scene player and by the story executor. */
export interface ScriptHost {
  engine: Engine;
  project: Project;
  vars: VarStore;
  /** Current scene API, or null when running outside a scene (rare). */
  scene: any | null;
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
    if (isExpr(v)) return evaluate(v as Expr, this.host.vars, this.host.engine.functionTable(builtinFunctions));
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

export function evaluateArgs(ctx: ScriptContext, def: BlockDef, block: Block): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of def.args) {
    let v = block.args?.[a.id];
    if (v === undefined || v === null) v = a.default ?? null;
    out[a.id] = a.type === 'expr' || isExpr(v) ? (v === null ? null : ctx.evaluate(v)) : v;
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
  private teardown: (() => void)[] = [];
  private stopped = false;
  /** Number of hat stacks that handled the last dispatched event. */
  lastHandled = 0;

  constructor(private host: ScriptHost, private stacks: () => ScriptStack[]) {}

  /** Start timer-style hats. Call once when the scene starts. */
  start(): void {
    for (const s of this.stacks()) {
      if (!s.enabled) continue;
      const def = this.host.engine.blocks.get(s.hat.type);
      const setup = (def as any)?.setup as ((ctx: ScriptContext, args: any, fire: () => void) => (() => void) | void) | undefined;
      if (!setup) continue;
      const ctx = new ScriptContext(this.host, new CancelToken(), s.id, null);
      try {
        const stop = setup(ctx, evaluateArgs(ctx, def!, s.hat), () => this.spawn(s, null));
        if (stop) this.teardown.push(stop);
      } catch (err) {
        this.host.reportError('script', err, { stackId: s.id });
      }
    }
  }

  dispatch(event: RuntimeEvent): number {
    if (this.stopped) return 0;
    let handled = 0;
    for (const s of this.stacks()) {
      if (!s.enabled) continue;
      const def = this.host.engine.blocks.get(s.hat.type);
      if (!def || def.shape !== 'hat' || def.event !== event.type) continue;
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
    this.threads.add(token);
    const ctx = new ScriptContext(this.host, token, stack.id, event);
    if (stack.hat) this.host.trace?.(stack.hat.id);
    return runBlocks(ctx, stack.body)
      .catch((err) => { if (!(err instanceof StopThread)) this.host.reportError('script', err, { stackId: stack.id }); })
      .finally(() => this.threads.delete(token));
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
    for (const fn of this.teardown) try { fn(); } catch { /* ignore */ }
    this.teardown = [];
  }
}
