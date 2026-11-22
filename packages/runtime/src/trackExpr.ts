/**
 * Track expressions (After Effects-style, kept small and safe): a formula that computes a
 * property from time, the track's own keyframed value and other elements.
 *
 *   follow("Mika", 0.3)          Mika's value of the same property, 0.3 s later
 *   follow("Mika", "x", 0.3)     …of another property
 *   value + wiggle(2, 15)         keyframed value plus a smooth random wobble (2 per second, ±15)
 *   sin(time * 3) * 40 + value    oscillate
 *   loop()                        repeat the keyframes over and over
 *
 * Numbers, "strings", + - * / % ^, comparisons, a ? b : c, parentheses and the functions below.
 * No JavaScript runs: formulas are parsed into a small tree.
 */

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; name: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'if'; c: Node; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

export interface ExprEnv {
  time: number;
  value: any;
  /** Value of a property of another element at a time (name or id). */
  follow(target: string, prop: string, at: number): any;
  /** The track's keyframed value at another time (for loop()). */
  valueAt(t: number): any;
  /** Last keyframe time of the track (for loop()). */
  keyEnd: number;
  /** Seed for wiggle (element + property), so wiggles differ but repeat exactly. */
  seed: number;
  prop: string;
}

const cache = new Map<string, { ast: Node | null; error: string | null }>();

export function compileExpr(src: string): { ast: Node | null; error: string | null } {
  const hit = cache.get(src);
  if (hit) return hit;
  let out: { ast: Node | null; error: string | null };
  try { out = { ast: parse(src), error: null }; } catch (e: any) { out = { ast: null, error: String(e?.message || e) }; }
  if (cache.size > 500) cache.clear();
  cache.set(src, out);
  return out;
}

export const EXPR_FUNCTIONS = ['follow', 'wiggle', 'loop', 'sin', 'cos', 'abs', 'min', 'max', 'clamp', 'round', 'floor', 'ceil', 'sqrt', 'lerp', 'step', 'noise'];

/* ---------------- parser ---------------- */

function parse(src: string): Node {
  const toks: { t: string; v: string }[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/%^(),?:<>!]))/y;
  let i = 0;
  const s = src.trim();
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m || m.index !== i) throw new Error(`Unexpected "${s.slice(i, i + 8)}"`);
    if (m[1] !== undefined) toks.push({ t: 'num', v: m[1] });
    else if (m[2] !== undefined) toks.push({ t: 'str', v: m[2].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) toks.push({ t: 'id', v: m[3] });
    else toks.push({ t: 'op', v: m[4] });
    i = re.lastIndex;
    while (i < s.length && /\s/.test(s[i])) i++;
  }
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => toks[p]?.t === 'op' && toks[p].v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); p++; };
  const prec: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7 };
  const ternary = (): Node => {
    const c = binary(1);
    if (isOp('?')) { p++; const a = ternary(); expect(':'); const b = ternary(); return { k: 'if', c, a, b }; }
    return c;
  };
  const binary = (minPrec: number): Node => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in prec)) break;
      const pr = prec[t.v];
      if (pr < minPrec) break;
      p++;
      const b = binary(t.v === '^' ? pr : pr + 1); // ^ groups to the right
      a = { k: 'bin', op: t.v, a, b };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-') || isOp('!') || isOp('+')) { const op = toks[p++].v; return { k: 'un', op, a: unary() }; }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'num') return { k: 'num', v: Number(t.v) };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'id') {
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { p++; args.push(ternary()); } }
        expect(')');
        if (!EXPR_FUNCTIONS.includes(t.v)) throw new Error(`Unknown function ${t.v}()`);
        return { k: 'call', name: t.v, args };
      }
      if (!['time', 'value', 'pi', 'true', 'false'].includes(t.v)) throw new Error(`Unknown name ${t.v}`);
      return { k: 'id', name: t.v };
    }
    if (t.v === '(') { const e = ternary(); expect(')'); return e; }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const ast = ternary();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return ast;
}

/* ---------------- evaluation ---------------- */

const n = (v: any) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);

/** Smooth 1D value noise in [-1, 1]. */
function noise(x: number, seed: number): number {
  const h = (i: number) => { let k = Math.imul(i ^ seed, 0x27d4eb2d); k ^= k >>> 15; k = Math.imul(k, 0x85ebca6b); k ^= k >>> 13; return ((k >>> 0) / 4294967295) * 2 - 1; };
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

export function evalExpr(ast: Node, env: ExprEnv): any {
  const ev = (x: Node): any => {
    switch (x.k) {
      case 'num': return x.v;
      case 'str': return x.v;
      case 'id': return x.name === 'time' ? env.time : x.name === 'value' ? env.value : x.name === 'pi' ? Math.PI : x.name === 'true';
      case 'un': { const a = ev(x.a); return x.op === '-' ? -n(a) : x.op === '!' ? !a : n(a); }
      case 'if': return ev(x.c) ? ev(x.a) : ev(x.b);
      case 'bin': {
        if (x.op === '&&') return ev(x.a) && ev(x.b);
        if (x.op === '||') return ev(x.a) || ev(x.b);
        const a = ev(x.a), b = ev(x.b);
        switch (x.op) {
          case '+': return typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : n(a) + n(b);
          case '-': return n(a) - n(b);
          case '*': return n(a) * n(b);
          case '/': return n(b) === 0 ? 0 : n(a) / n(b);
          case '%': return n(b) === 0 ? 0 : n(a) % n(b);
          case '^': return Math.pow(n(a), n(b));
          case '==': return a === b || (typeof a !== 'string' && typeof b !== 'string' && n(a) === n(b));
          case '!=': return !(a === b || (typeof a !== 'string' && typeof b !== 'string' && n(a) === n(b)));
          case '<': return n(a) < n(b);
          case '<=': return n(a) <= n(b);
          case '>': return n(a) > n(b);
          case '>=': return n(a) >= n(b);
        }
        return 0;
      }
      case 'call': {
        const a = x.args.map(ev);
        switch (x.name) {
          case 'follow': {
            const target = String(a[0] ?? '');
            const prop = typeof a[1] === 'string' ? a[1] : env.prop;
            const delay = n(typeof a[1] === 'string' ? a[2] : a[1]);
            return env.follow(target, prop, env.time - delay);
          }
          case 'wiggle': { const f = a.length ? n(a[0]) : 1, amp = a.length > 1 ? n(a[1]) : 10; return n(env.value) + noise(env.time * f, env.seed) * amp; }
          case 'noise': return noise(n(a[0]), env.seed);
          case 'loop': return env.keyEnd > 0 ? env.valueAt(((env.time % env.keyEnd) + env.keyEnd) % env.keyEnd) : env.value;
          case 'sin': return Math.sin(n(a[0]));
          case 'cos': return Math.cos(n(a[0]));
          case 'abs': return Math.abs(n(a[0]));
          case 'min': return Math.min(...a.map(n));
          case 'max': return Math.max(...a.map(n));
          case 'clamp': return Math.max(n(a[1]), Math.min(n(a[2]), n(a[0])));
          case 'round': return Math.round(n(a[0]));
          case 'floor': return Math.floor(n(a[0]));
          case 'ceil': return Math.ceil(n(a[0]));
          case 'sqrt': return Math.sqrt(Math.max(0, n(a[0])));
          case 'lerp': return n(a[0]) + (n(a[1]) - n(a[0])) * n(a[2]);
          case 'step': return n(a[1]) >= n(a[0]) ? 1 : 0;
        }
        return 0;
      }
    }
  };
  return ev(ast);
}
