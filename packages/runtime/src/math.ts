/** 2D affine matrix [a, b, c, d, e, f] matching CanvasRenderingContext2D.setTransform. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  const id = 1 / det;
  return [m[3] * id, -m[1] * id, -m[2] * id, m[0] * id, (m[2] * m[5] - m[3] * m[4]) * id, (m[1] * m[4] - m[0] * m[5]) * id];
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Local matrix of a layer: position → rotation → scale → anchor offset. */
export function layerMatrix(p: Record<string, any>, w: number, h: number): Mat {
  const x = num(p.x), y = num(p.y);
  const r = (num(p.rotation) * Math.PI) / 180;
  const sx = p.scaleX === undefined ? 1 : num(p.scaleX);
  const sy = p.scaleY === undefined ? 1 : num(p.scaleY);
  const ax = (p.anchorX === undefined ? 0.5 : num(p.anchorX)) * w;
  const ay = (p.anchorY === undefined ? 0.5 : num(p.anchorY)) * h;
  const cos = Math.cos(r), sin = Math.sin(r);
  // T(x,y) * R * S * T(-ax,-ay)
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  return [a, b, c, d, x - (a * ax + c * ay), y - (b * ax + d * ay)];
}

export function num(v: any, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ */
/* Colors                                                               */
/* ------------------------------------------------------------------ */

export interface RGBA { r: number; g: number; b: number; a: number }

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', transparent: '#00000000' };

export function parseColor(input: any): RGBA {
  if (input && typeof input === 'object' && 'r' in input) return input as RGBA;
  let s = String(input || '').trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function colorToString(c: RGBA): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}

export function colorToHex(c: RGBA): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a * 255) : ''}`;
}

export function lerpColor(a: any, b: any, t: number): string {
  const x = parseColor(a), y = parseColor(b);
  return colorToString({ r: lerp(x.r, y.r, t), g: lerp(x.g, y.g, t), b: lerp(x.b, y.b, t), a: lerp(x.a, y.a, t) });
}

/* ------------------------------------------------------------------ */
/* Cubic bezier easing (CSS-style)                                       */
/* ------------------------------------------------------------------ */

export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = sampleX(s) - t;
    if (Math.abs(x) < 1e-6) return sampleY(s);
    const d = dX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= x / d;
  }
  let lo = 0, hi = 1;
  s = t;
  for (let i = 0; i < 30; i++) {
    const x = sampleX(s);
    if (Math.abs(x - t) < 1e-6) break;
    if (t > x) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return sampleY(s);
}
