import { useRef } from 'react';
import type { Expr, Project, SceneData, BinaryOp, VarValue } from '@vne/core';
import { builtinFunctions } from '@vne/core';
import { openMenu, MenuItem } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/controls';

export interface ExprCtx { project: Project; scene?: SceneData | null; t: (k: string, p?: any) => string }

const COMPARE: BinaryOp[] = ['==', '!=', '<', '<=', '>', '>='];
const MATH: BinaryOp[] = ['+', '-', '*', '/', '%'];
const TEXT: BinaryOp[] = ['contains', 'startsWith', 'join'];

function vars(ctx: ExprCtx) {
  return [...ctx.project.variables, ...(ctx.scene?.localVariables || [])];
}

function defaultCompare(ctx: ExprCtx): Expr {
  const v = vars(ctx)[0];
  const lit: VarValue = v ? (v.type === 'number' ? 1 : v.type === 'boolean' ? true : '') : 1;
  return { k: 'op', op: v?.type === 'number' ? '>=' : '==', a: v ? { k: 'var', id: v.id } : { k: 'lit', v: 0 }, b: { k: 'lit', v: lit } };
}

/** Change-kind menu shared by every pill. */
function kindMenu(e: { clientX: number; clientY: number }, expr: Expr | null, onChange: (e: Expr | null) => void, ctx: ExprCtx, allowClear: boolean) {
  const t = ctx.t;
  const wrapSelf = (op: BinaryOp): Expr => ({ k: 'op', op, a: expr || { k: 'lit', v: true }, b: defaultCompare(ctx) });
  const items: MenuItem[] = [
    { header: true, label: t('expr.replace') },
    { label: t('expr.value'), icon: 'hash', onClick: () => onChange({ k: 'lit', v: 0 }) },
    { label: t('expr.text'), icon: 'quote', onClick: () => onChange({ k: 'lit', v: '' }) },
    { label: t('expr.true'), icon: 'check', onClick: () => onChange({ k: 'lit', v: true }) },
    { label: t('expr.variable'), icon: 'variable', disabled: !vars(ctx).length, onClick: () => onChange({ k: 'var', id: vars(ctx)[0].id }) },
    { label: t('expr.compare'), icon: 'branch', onClick: () => onChange(defaultCompare(ctx)) },
    { label: t('expr.math'), icon: 'plus', onClick: () => onChange({ k: 'op', op: '+', a: { k: 'lit', v: 1 }, b: { k: 'lit', v: 1 } }) },
    { label: t('expr.textOp'), icon: 'type', onClick: () => onChange({ k: 'op', op: 'contains', a: { k: 'lit', v: '' }, b: { k: 'lit', v: '' } }) },
    { label: t('expr.function'), icon: 'wand', submenu: Object.values(builtinFunctions).map((f) => ({ label: `${f.label}(${Array.from({ length: f.args }, (_, i) => 'abc'[i]).join(', ')})`, onClick: () => onChange({ k: 'fn', fn: f.id, args: Array.from({ length: f.args }, () => ({ k: 'lit', v: 0 } as Expr)) }) })) },
  ];
  if (expr) {
    items.push({ separator: true }, { header: true, label: t('expr.combine') },
      { label: t('expr.andWith'), onClick: () => onChange(wrapSelf('and')) },
      { label: t('expr.orWith'), onClick: () => onChange(wrapSelf('or')) },
      { label: t('expr.not'), onClick: () => onChange({ k: 'not', a: expr }) });
    if (expr.k === 'not') items.push({ label: t('expr.removeNot'), onClick: () => onChange(expr.a) });
    if (expr.k === 'op' && (expr.op === 'and' || expr.op === 'or')) items.push({ label: t('expr.keepLeft'), onClick: () => onChange(expr.a) }, { label: t('expr.keepRight'), onClick: () => onChange(expr.b) });
  }
  if (allowClear) items.push({ separator: true }, { label: t('expr.clear'), icon: 'close', danger: true, onClick: () => onChange(null) });
  openMenu(e, items);
}

/**
 * Inline expression builder: nested "reporter" pills like Scratch. Every pill
 * has a ▾ handle to replace or combine it; values are edited in place.
 */
export function ExprInput({ value, onChange, ctx, placeholder, allowClear = true, numeric }: { value: Expr | null | undefined; onChange: (e: Expr | null) => void; ctx: ExprCtx; placeholder?: string; allowClear?: boolean; numeric?: boolean }) {
  if (!value) {
    return (
      <button type="button" className="expr-empty" onClick={(e) => kindMenu(e, null, onChange, ctx, false)}>
        <Icon name="plus" size={12} /> {placeholder || ctx.t('expr.addCondition')}
      </button>
    );
  }
  return <ExprPill expr={value} onChange={(e) => onChange(e)} ctx={ctx} root allowClear={allowClear} numeric={numeric} />;
}

function ExprPill({ expr, onChange, ctx, root, allowClear, numeric }: { expr: Expr; onChange: (e: Expr | null) => void; ctx: ExprCtx; root?: boolean; allowClear?: boolean; numeric?: boolean }) {
  const t = ctx.t;
  const handle = (
    <button type="button" className="expr-handle" title={t('expr.change')} onClick={(e) => kindMenu(e, expr, (x) => (x ? onChange(x) : onChange(root ? null : { k: 'lit', v: 0 })), ctx, !!allowClear || !root)}>
      <Icon name="chevronDown" size={11} />
    </button>
  );
  const sub = (e: Expr, set: (x: Expr) => void) => <ExprPill expr={e} onChange={(x) => set(x || { k: 'lit', v: 0 })} ctx={ctx} allowClear />;
  switch (expr.k) {
    case 'lit': {
      const v = expr.v;
      if (typeof v === 'boolean') {
        return <span className="expr pill bool">{handle}<button type="button" className="expr-bool" onClick={() => onChange({ k: 'lit', v: !v })}>{v ? t('expr.true') : t('expr.false')}</button></span>;
      }
      const isNum = typeof v === 'number';
      return (
        <span className={cx('expr pill', isNum ? 'num' : 'str')}>
          {handle}
          <LitInput value={Array.isArray(v) ? v.join(", ") : v} numeric={isNum || numeric} onChange={(nv) => onChange({ k: 'lit', v: nv })} />
        </span>
      );
    }
    case 'var': {
      const list = vars(ctx);
      const known = list.find((x) => x.id === expr.id);
      return (
        <span className={cx('expr pill var', !known && 'missing')}>
          {handle}
          <select value={expr.id} onChange={(e) => onChange({ k: 'var', id: e.target.value })} aria-label={t('expr.variable')} onKeyDown={(e) => e.stopPropagation()}>
            {!known && <option value={expr.id}>{t('expr.missingVar')}</option>}
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </span>
      );
    }
    case 'not':
      return <span className="expr group logic">{handle}<span className="expr-word">{t('expr.notWord')}</span>{sub(expr.a, (a) => onChange({ ...expr, a }))}</span>;
    case 'op': {
      const isLogic = expr.op === 'and' || expr.op === 'or';
      const ops = isLogic ? (['and', 'or'] as BinaryOp[]) : COMPARE.includes(expr.op) ? COMPARE : MATH.includes(expr.op) ? MATH : TEXT;
      return (
        <span className={cx('expr group', isLogic ? 'logic' : COMPARE.includes(expr.op) ? 'compare' : 'math')}>
          {handle}
          {sub(expr.a, (a) => onChange({ ...expr, a }))}
          <select className="expr-op" value={expr.op} onChange={(e) => onChange({ ...expr, op: e.target.value as BinaryOp })} aria-label={t('expr.operator')} onKeyDown={(e) => e.stopPropagation()}>
            {ops.map((o) => <option key={o} value={o}>{t(`op.sym.${o}`)}</option>)}
          </select>
          {sub(expr.b, (b) => onChange({ ...expr, b }))}
        </span>
      );
    }
    case 'fn':
      return (
        <span className="expr group fn">
          {handle}
          <span className="expr-word">{expr.fn}(</span>
          {expr.args.map((a, i) => <span key={i}>{i > 0 && <span className="expr-word">,</span>}{sub(a, (x) => onChange({ ...expr, args: expr.args.map((y, j) => (j === i ? x : y)) }))}</span>)}
          <span className="expr-word">)</span>
        </span>
      );
  }
  return null;
}

function LitInput({ value, numeric, onChange }: { value: string | number; numeric?: boolean; onChange: (v: string | number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const width = Math.max(2, String(value).length + 1);
  return (
    <input
      ref={ref}
      className="expr-lit"
      defaultValue={String(value)}
      key={String(value)}
      style={{ width: `${Math.min(24, width)}ch` }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ref.current?.blur(); }}
      onBlur={(e) => {
        const s = e.target.value;
        if (numeric) { const n = Number(s); onChange(Number.isFinite(n) ? n : 0); }
        else onChange(s);
      }}
      aria-label="value"
    />
  );
}

/** A typed argument for blocks: literal input by default, can switch to an expression. */
export function ValueInput({ value, onChange, ctx, numeric }: { value: any; onChange: (v: any) => void; ctx: ExprCtx; numeric?: boolean }) {
  const expr: Expr = value && typeof value === 'object' && 'k' in value ? value : { k: 'lit', v: value ?? (numeric ? 0 : '') };
  return <ExprPill expr={expr} onChange={(e) => onChange(e && e.k === 'lit' ? e.v : e)} ctx={ctx} allowClear={false} numeric={numeric} />;
}
