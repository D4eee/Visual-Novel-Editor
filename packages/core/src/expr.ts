import type { BinaryOp, Expr, VarOp, VarValue, VariableDef, ScalarValue } from './types';

/** Anything that can resolve a variable id to a value. */
export interface VarScope {
  get(id: string): VarValue | undefined;
}

export interface ExprFunction {
  id: string;
  label: string;
  args: number;
  fn: (...args: VarValue[]) => VarValue;
}

export const builtinFunctions: Record<string, ExprFunction> = {
  random: { id: 'random', label: 'random', args: 2, fn: (a, b) => {
    const lo = Number(a), hi = Number(b);
    return Math.floor(lo + Math.random() * (hi - lo + 1));
  } },
  min: { id: 'min', label: 'min', args: 2, fn: (a, b) => Math.min(Number(a), Number(b)) },
  max: { id: 'max', label: 'max', args: 2, fn: (a, b) => Math.max(Number(a), Number(b)) },
  abs: { id: 'abs', label: 'abs', args: 1, fn: (a) => Math.abs(Number(a)) },
  round: { id: 'round', label: 'round', args: 1, fn: (a) => Math.round(Number(a)) },
  floor: { id: 'floor', label: 'floor', args: 1, fn: (a) => Math.floor(Number(a)) },
  length: { id: 'length', label: 'length', args: 1, fn: (a) => (Array.isArray(a) ? a.length : String(a).length) },
  /** item(list, n): the n-th item (1-based). */
  item: { id: 'item', label: 'item', args: 2, fn: (l, n) => (Array.isArray(l) ? l[Math.floor(Number(n)) - 1] ?? '' : '') },
  /** count(list, value): how many times value is in the list. */
  count: { id: 'count', label: 'count', args: 2, fn: (l, v) => (Array.isArray(l) ? l.filter((x) => String(x).toLowerCase() === String(v).toLowerCase()).length : 0) },
  upper: { id: 'upper', label: 'upper', args: 1, fn: (a) => String(a).toUpperCase() },
  lower: { id: 'lower', label: 'lower', args: 1, fn: (a) => String(a).toLowerCase() },
  /** has(item): does the player carry this collectible (name or id)? Answered by the game while it plays. */
  has: { id: 'has', label: 'has', args: 1, fn: () => false },
};

export function lit(v: VarValue): Expr {
  return { k: 'lit', v };
}

export function varRef(id: string): Expr {
  return { k: 'var', id };
}

export function isExpr(v: unknown): v is Expr {
  return !!v && typeof v === 'object' && typeof (v as any).k === 'string';
}

function toNum(v: VarValue | undefined): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: VarValue | undefined): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  return !!v;
}

export function applyOp(op: BinaryOp, a: VarValue, b: VarValue): VarValue {
  switch (op) {
    case '+':
      if (Array.isArray(a) || Array.isArray(b)) return [...toList(a), ...toList(b)];
      if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
      return toNum(a) + toNum(b);
    case '-': return toNum(a) - toNum(b);
    case '*': return toNum(a) * toNum(b);
    case '/': { const d = toNum(b); return d === 0 ? 0 : toNum(a) / d; }
    case '%': { const d = toNum(b); return d === 0 ? 0 : toNum(a) % d; }
    case '==': return looseEq(a, b);
    case '!=': return !looseEq(a, b);
    case '<': return cmp(a, b) < 0;
    case '<=': return cmp(a, b) <= 0;
    case '>': return cmp(a, b) > 0;
    case '>=': return cmp(a, b) >= 0;
    case 'and': return truthy(a) && truthy(b);
    case 'or': return truthy(a) || truthy(b);
    case 'contains': return Array.isArray(a) ? a.some((x) => String(x).toLowerCase() === String(b).toLowerCase()) : String(a).includes(String(b));
    case 'startsWith': return String(a).startsWith(String(b));
    case 'join': return (Array.isArray(a) ? a.join(', ') : String(a)) + (Array.isArray(b) ? b.join(', ') : String(b));
  }
  return false;
}

function looseEq(a: VarValue, b: VarValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(toList(a)) === JSON.stringify(toList(b));
  if (typeof a === typeof b) return a === b;
  if (typeof a === 'number' || typeof b === 'number') return toNum(a) === toNum(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
  return String(a) === String(b);
}

function cmp(a: VarValue, b: VarValue): number {
  if (typeof a === 'string' && typeof b === 'string' && (isNaN(Number(a)) || isNaN(Number(b)))) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return toNum(a) - toNum(b);
}

export function evaluate(expr: Expr | null | undefined, scope: VarScope, fns: Record<string, ExprFunction> = builtinFunctions): VarValue {
  if (!expr) return true;
  switch (expr.k) {
    case 'lit': return expr.v;
    case 'var': { const v = scope.get(expr.id); return v === undefined ? 0 : v; }
    case 'not': return !truthy(evaluate(expr.a, scope, fns));
    case 'op': {
      if (expr.op === 'and') return truthy(evaluate(expr.a, scope, fns)) && truthy(evaluate(expr.b, scope, fns));
      if (expr.op === 'or') return truthy(evaluate(expr.a, scope, fns)) || truthy(evaluate(expr.b, scope, fns));
      return applyOp(expr.op, evaluate(expr.a, scope, fns), evaluate(expr.b, scope, fns));
    }
    case 'fn': {
      const f = fns[expr.fn];
      if (!f) throw new Error(`Unknown function "${expr.fn}"`);
      return f.fn(...expr.args.map((a) => evaluate(a, scope, fns)));
    }
  }
  return false;
}

export function evaluateBool(expr: Expr | null | undefined, scope: VarScope, fns?: Record<string, ExprFunction>): boolean {
  return truthy(evaluate(expr, scope, fns));
}

export function coerce(type: VariableDef['type'], v: VarValue): VarValue {
  if (type === 'list') return toList(v);
  if (Array.isArray(v)) v = v.join(', ');
  if (type === 'number') return toNum(v);
  if (type === 'boolean') return truthy(v);
  return String(v);
}

/** A list value: lists are copied, text "a, b" is split, other values become one item, empty means []. */
export function toList(v: VarValue | null | undefined): ScalarValue[] {
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? String(x) : x));
  if (v === null || v === undefined || v === '') return [];
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [v];
}

export function applyVarOp(def: VariableDef | undefined, current: VarValue | undefined, op: VarOp): VarValue {
  const type = def?.type ?? (typeof op.value as VariableDef['type']);
  switch (op.op) {
    case 'set': return coerce(type, op.value);
    case 'add': if (type === 'list') return [...toList(current), ...toList(op.value as VarValue)];
      return type === 'string' ? String(current ?? '') + String(op.value) : toNum(current) + toNum(op.value);
    case 'sub': return toNum(current) - toNum(op.value);
    case 'toggle': return !truthy(current);
  }
  return current ?? 0;
}

/** Collect every variable id referenced by an expression. */
export function exprVars(expr: Expr | null | undefined, out: Set<string> = new Set()): Set<string> {
  if (!expr) return out;
  if (expr.k === 'var') out.add(expr.id);
  else if (expr.k === 'op') { exprVars(expr.a, out); exprVars(expr.b, out); }
  else if (expr.k === 'not') exprVars(expr.a, out);
  else if (expr.k === 'fn') expr.args.forEach((a) => exprVars(a, out));
  return out;
}

/** Human-readable rendering used in graph node summaries. */
export function exprToString(expr: Expr | null | undefined, varName: (id: string) => string): string {
  if (!expr) return '—';
  switch (expr.k) {
    case 'lit': return typeof expr.v === 'string' ? JSON.stringify(expr.v) : String(expr.v);
    case 'var': return varName(expr.id);
    case 'not': return `not ${exprToString(expr.a, varName)}`;
    case 'op': {
      const inner = `${exprToString(expr.a, varName)} ${expr.op} ${exprToString(expr.b, varName)}`;
      return expr.op === 'and' || expr.op === 'or' ? `(${inner})` : inner;
    }
    case 'fn': return `${expr.fn}(${expr.args.map((a) => exprToString(a, varName)).join(', ')})`;
  }
  return '?';
}

export { truthy, toNum };
