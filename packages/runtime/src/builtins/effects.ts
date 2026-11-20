import type { Engine, EffectNodeDef } from '@vne/core';
import { ctx2d, Canvas } from '../effects';
import { num, parseColor, lerpColor } from '../math';

const img = (id = 'image', label = 'fx.port.image') => ({ id, label, type: 'image' as const });
const n = (id: string, label: string, def: number, min?: number, max?: number, step?: number) => ({ id, label, type: 'number' as const, default: def, min, max, step });
const OUT_IMG = [img('image', 'fx.port.result')];

function sized(ctx: any, src: Canvas | null): { w: number; h: number } {
  return { w: src?.width || ctx.width || 256, h: src?.height || ctx.height || 256 };
}

function withFilter(ctx: any, src: Canvas | null, filter: string): Canvas | null {
  if (!src) return null;
  const out = ctx.pool.acquire(src.width, src.height);
  const c = ctx2d(out);
  c.filter = filter;
  c.drawImage(src as any, 0, 0);
  c.filter = 'none';
  return out;
}

function rgb(c: any): [number, number, number, number] {
  const x = parseColor(c);
  return [x.r / 255, x.g / 255, x.b / 255, x.a];
}

const BLEND_MODES = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'lighter'];

const WAVE = `uniform float amp; uniform float freq; uniform float speed; uniform float dir;
void main(){ vec2 p = uv; float t = u_time * speed;
 if (dir < 0.5) p.x += sin(p.y * freq + t) * amp / u_size.x; else p.y += sin(p.x * freq + t) * amp / u_size.y;
 gl_FragColor = texture2D(u_image, p); }`;
const CHROMA = `uniform float amount; void main(){ vec2 o = vec2(amount / u_size.x, 0.0);
 vec4 c = texture2D(u_image, uv); float r = texture2D(u_image, uv + o).r; float b = texture2D(u_image, uv - o).b;
 gl_FragColor = vec4(r, c.g, b, max(c.a, max(texture2D(u_image, uv + o).a, texture2D(u_image, uv - o).a))); }`;
const NOISE = `uniform float scale; uniform float seed; uniform float speed; uniform vec4 colA; uniform vec4 colB;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 17.0) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
 return mix(mix(h(i), h(i+vec2(1.0,0.0)), u.x), mix(h(i+vec2(0.0,1.0)), h(i+vec2(1.0,1.0)), u.x), u.y); }
void main(){ vec2 p = uv * u_size / max(1.0, scale) + vec2(u_time * speed, u_time * speed * 0.6);
 float v = n(p) * 0.5 + n(p * 2.0) * 0.25 + n(p * 4.0) * 0.125; v /= 0.875; gl_FragColor = mix(colA, colB, v); }`;
const RIPPLE = `uniform float amp; uniform float freq; uniform float speed; uniform vec2 center;
void main(){ vec2 d = uv - center; float r = length(d * u_size) ; float w = sin(r / max(1.0, freq) - u_time * speed) * amp;
 vec2 p = uv + normalize(d + 1e-5) * w / u_size; gl_FragColor = texture2D(u_image, p); }`;

export function registerBuiltinEffects(engine: Engine): void {
  const R = (def: EffectNodeDef) => engine.effectNodes.register(def, 'core');

  /* Input / output -------------------------------------------------------- */
  R({ id: 'fx.input', label: 'fx.input', category: 'input', inputs: [], outputs: [img('image', 'fx.port.layer'), { id: 'width', label: 'fx.port.width', type: 'number' }, { id: 'height', label: 'fx.port.height', type: 'number' }],
    evaluate: (ctx) => ({ image: ctx.input, width: ctx.input?.width || 0, height: ctx.input?.height || 0 }) });
  R({ id: 'fx.output', label: 'fx.output', category: 'output', inputs: [img()], outputs: [], evaluate: () => ({}) });

  /* Filters ------------------------------------------------------------------ */
  R({ id: 'fx.blur', label: 'fx.blur', category: 'filter', inputs: [img(), n('radius', 'fx.port.radius', 6, 0, 100, 0.5)], outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: num(i.radius) <= 0 ? i.image : withFilter(ctx, i.image, `blur(${num(i.radius)}px)`) }) });
  R({ id: 'fx.colorAdjust', label: 'fx.colorAdjust', category: 'color',
    inputs: [img(), n('brightness', 'fx.port.brightness', 1, 0, 3, 0.05), n('contrast', 'fx.port.contrast', 1, 0, 3, 0.05), n('saturation', 'fx.port.saturation', 1, 0, 3, 0.05), n('hue', 'fx.port.hue', 0, -180, 180, 1)],
    outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: withFilter(ctx, i.image, `brightness(${num(i.brightness, 1)}) contrast(${num(i.contrast, 1)}) saturate(${num(i.saturation, 1)}) hue-rotate(${num(i.hue)}deg)`) }) });
  R({ id: 'fx.grayscale', label: 'fx.grayscale', category: 'color', inputs: [img(), n('amount', 'fx.port.amount', 1, 0, 1, 0.05)], outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: withFilter(ctx, i.image, `grayscale(${num(i.amount, 1)})`) }) });
  R({ id: 'fx.sepia', label: 'fx.sepia', category: 'color', inputs: [img(), n('amount', 'fx.port.amount', 1, 0, 1, 0.05)], outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: withFilter(ctx, i.image, `sepia(${num(i.amount, 1)})`) }) });
  R({ id: 'fx.invert', label: 'fx.invert', category: 'color', inputs: [img(), n('amount', 'fx.port.amount', 1, 0, 1, 0.05)], outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: withFilter(ctx, i.image, `invert(${num(i.amount, 1)})`) }) });
  R({ id: 'fx.tint', label: 'fx.tint', category: 'color', inputs: [img(), { id: 'color', label: 'fx.port.color', type: 'color', default: '#ff9a6a' }, n('amount', 'fx.port.amount', 0.5, 0, 1, 0.05)], outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image;
      if (!src) return { image: null };
      const out = ctx.pool.acquire(src.width, src.height);
      const c = ctx2d(out);
      c.drawImage(src as any, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      c.globalAlpha = Math.max(0, Math.min(1, num(i.amount, 0.5)));
      c.fillStyle = i.color;
      c.fillRect(0, 0, out.width, out.height);
      return { image: out };
    } });
  R({ id: 'fx.opacity', label: 'fx.opacity', category: 'color', inputs: [img(), n('amount', 'fx.port.amount', 0.5, 0, 1, 0.05)], outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image;
      if (!src) return { image: null };
      const out = ctx.pool.acquire(src.width, src.height);
      const c = ctx2d(out);
      c.globalAlpha = Math.max(0, Math.min(1, num(i.amount, 1)));
      c.drawImage(src as any, 0, 0);
      return { image: out };
    } });
  R({ id: 'fx.shadow', label: 'fx.shadow', category: 'filter',
    inputs: [img(), { id: 'color', label: 'fx.port.color', type: 'color', default: 'rgba(0,0,0,0.6)' }, n('blur', 'fx.port.radius', 12, 0, 100), n('offsetX', 'fx.port.offsetX', 0, -200, 200), n('offsetY', 'fx.port.offsetY', 8, -200, 200)],
    outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: withFilter(ctx, i.image, `drop-shadow(${num(i.offsetX)}px ${num(i.offsetY)}px ${num(i.blur)}px ${i.color})`) }) });
  R({ id: 'fx.glow', label: 'fx.glow', category: 'filter',
    inputs: [img(), { id: 'color', label: 'fx.port.color', type: 'color', default: '#ffe29a' }, n('radius', 'fx.port.radius', 16, 0, 120), n('strength', 'fx.port.strength', 1, 0, 4, 0.1)],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image;
      if (!src) return { image: null };
      const out = ctx.pool.acquire(src.width, src.height);
      const c = ctx2d(out);
      const passes = Math.max(1, Math.round(num(i.strength, 1) * 2));
      c.filter = `drop-shadow(0 0 ${num(i.radius, 16)}px ${i.color})`;
      for (let k = 0; k < passes; k++) c.drawImage(src as any, 0, 0);
      c.filter = 'none';
      c.drawImage(src as any, 0, 0);
      return { image: out };
    } });
  R({ id: 'fx.pixelate', label: 'fx.pixelate', category: 'distort', inputs: [img(), n('size', 'fx.port.cell', 8, 1, 128, 1)], outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image;
      if (!src) return { image: null };
      const s = Math.max(1, num(i.size, 8));
      const small = ctx.pool.acquire(Math.max(1, src.width / s), Math.max(1, src.height / s));
      const sc = ctx2d(small);
      sc.imageSmoothingEnabled = true;
      sc.drawImage(src as any, 0, 0, small.width, small.height);
      const out = ctx.pool.acquire(src.width, src.height);
      const c = ctx2d(out);
      c.imageSmoothingEnabled = false;
      c.drawImage(small as any, 0, 0, src.width, src.height);
      return { image: out };
    } });
  R({ id: 'fx.wave', label: 'fx.wave', category: 'distort', animated: true,
    inputs: [img(), n('amplitude', 'fx.port.amplitude', 8, 0, 200), n('frequency', 'fx.port.frequency', 12, 0, 100), n('speed', 'fx.port.speed', 2, -20, 20, 0.1),
      { id: 'direction', label: 'fx.port.direction', type: 'select', default: 'horizontal', options: [{ value: 'horizontal', label: 'dir.horizontal' }, { value: 'vertical', label: 'dir.vertical' }], inlineOnly: true }],
    outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: i.image ? ctx.shaders.run(ctx.pool, WAVE, i.image, { amp: num(i.amplitude), freq: num(i.frequency), speed: num(i.speed), dir: i.direction === 'vertical' ? 1 : 0 }, ctx.time) : null }) });
  R({ id: 'fx.ripple', label: 'fx.ripple', category: 'distort', animated: true,
    inputs: [img(), n('amplitude', 'fx.port.amplitude', 6, 0, 100), n('wavelength', 'fx.port.wavelength', 10, 1, 200), n('speed', 'fx.port.speed', 4, -30, 30, 0.1), n('cx', 'fx.port.centerX', 0.5, 0, 1, 0.01), n('cy', 'fx.port.centerY', 0.5, 0, 1, 0.01)],
    outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: i.image ? ctx.shaders.run(ctx.pool, RIPPLE, i.image, { amp: num(i.amplitude), freq: num(i.wavelength, 10), speed: num(i.speed), center: [num(i.cx, 0.5), 1 - num(i.cy, 0.5)] }, ctx.time) : null }) });
  R({ id: 'fx.chromatic', label: 'fx.chromatic', category: 'distort', inputs: [img(), n('amount', 'fx.port.amount', 4, 0, 50, 0.5)], outputs: OUT_IMG,
    evaluate: (ctx, i) => ({ image: i.image ? ctx.shaders.run(ctx.pool, CHROMA, i.image, { amount: num(i.amount) }, ctx.time) : null }) });
  R({ id: 'fx.vignette', label: 'fx.vignette', category: 'filter',
    inputs: [img(), n('amount', 'fx.port.amount', 0.6, 0, 1, 0.05), n('softness', 'fx.port.softness', 0.5, 0.01, 1, 0.01), { id: 'color', label: 'fx.port.color', type: 'color', default: '#000000' }],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image;
      if (!src) return { image: null };
      const out = ctx.pool.acquire(src.width, src.height);
      const c = ctx2d(out);
      c.drawImage(src as any, 0, 0);
      const w = out.width, h = out.height, r = Math.hypot(w, h) / 2;
      const g = c.createRadialGradient(w / 2, h / 2, r * (1 - num(i.softness, 0.5)), w / 2, h / 2, r);
      const col = parseColor(i.color);
      g.addColorStop(0, `rgba(${col.r},${col.g},${col.b},0)`);
      g.addColorStop(1, `rgba(${col.r},${col.g},${col.b},${num(i.amount, 0.6)})`);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      return { image: out };
    } });

  /* Generators --------------------------------------------------------------- */
  R({ id: 'fx.noise', label: 'fx.noise', category: 'generate', animated: true,
    inputs: [n('scale', 'fx.port.scale', 40, 1, 500), n('seed', 'fx.port.seed', 1, 0, 1000, 1), n('speed', 'fx.port.speed', 0, -10, 10, 0.1),
      { id: 'colorA', label: 'fx.port.colorA', type: 'color', default: '#000000' }, { id: 'colorB', label: 'fx.port.colorB', type: 'color', default: '#ffffff' }],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const { w, h } = sized(ctx, ctx.input);
      const blank = ctx.pool.acquire(w, h);
      const out = ctx.shaders.run(ctx.pool, NOISE, blank, { scale: num(i.scale, 40), seed: num(i.seed, 1), speed: num(i.speed), colA: rgb(i.colorA), colB: rgb(i.colorB) }, ctx.time);
      if (out === blank) { // WebGL unavailable: cheap 2D fallback
        const c = ctx2d(blank);
        const s = Math.max(2, num(i.scale, 40) / 4);
        for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { c.fillStyle = lerpColor(i.colorA, i.colorB, Math.random()); c.fillRect(x, y, s, s); }
      }
      return { image: out };
    } });
  R({ id: 'fx.gradient', label: 'fx.gradient', category: 'generate',
    inputs: [{ id: 'colorA', label: 'fx.port.colorA', type: 'color', default: '#ffffff' }, { id: 'colorB', label: 'fx.port.colorB', type: 'color', default: 'rgba(255,255,255,0)' }, n('angle', 'fx.port.angle', 90, -360, 360, 1),
      { id: 'shape', label: 'fx.port.shape', type: 'select', default: 'linear', options: [{ value: 'linear', label: 'gradient.linear' }, { value: 'radial', label: 'gradient.radial' }], inlineOnly: true }],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const { w, h } = sized(ctx, ctx.input);
      const out = ctx.pool.acquire(w, h);
      const c = ctx2d(out);
      let g: CanvasGradient;
      if (i.shape === 'radial') g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
      else { const a = (num(i.angle, 90) * Math.PI) / 180; const dx = (Math.cos(a) * w) / 2, dy = (Math.sin(a) * h) / 2; g = c.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy); }
      g.addColorStop(0, i.colorA);
      g.addColorStop(1, i.colorB);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      return { image: out };
    } });

  /* Compositing --------------------------------------------------------------- */
  R({ id: 'fx.blend', label: 'fx.blend', category: 'composite',
    inputs: [img('a', 'fx.port.base'), img('b', 'fx.port.blendLayer'), { id: 'mode', label: 'fx.port.mode', type: 'select', default: 'screen', options: BLEND_MODES.map((m) => ({ value: m, label: `blend.${m}` })), inlineOnly: true }, n('amount', 'fx.port.amount', 1, 0, 1, 0.05)],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const a: Canvas | null = i.a, b: Canvas | null = i.b;
      if (!a) return { image: b };
      const out = ctx.pool.acquire(a.width, a.height);
      const c = ctx2d(out);
      c.drawImage(a as any, 0, 0);
      if (b) {
        c.globalAlpha = Math.max(0, Math.min(1, num(i.amount, 1)));
        c.globalCompositeOperation = (BLEND_MODES.includes(i.mode) ? i.mode : 'source-over') as GlobalCompositeOperation;
        c.save();
        c.globalCompositeOperation = c.globalCompositeOperation;
        c.drawImage(b as any, 0, 0, a.width, a.height);
        c.restore();
        // keep the base's alpha so the blend does not spill outside the layer
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(a as any, 0, 0);
      }
      return { image: out };
    } });
  R({ id: 'fx.mask', label: 'fx.mask', category: 'composite',
    inputs: [img(), img('mask', 'fx.port.mask'), { id: 'invert', label: 'fx.port.invert', type: 'boolean', default: false }],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image, m: Canvas | null = i.mask;
      if (!src || !m) return { image: src };
      const out = ctx.pool.acquire(src.width, src.height);
      const c = ctx2d(out);
      c.drawImage(src as any, 0, 0);
      c.globalCompositeOperation = i.invert ? 'destination-out' : 'destination-in';
      c.drawImage(m as any, 0, 0, src.width, src.height);
      return { image: out };
    } });
  R({ id: 'fx.shapeMask', label: 'fx.shapeMask', category: 'composite',
    inputs: [img(), { id: 'shape', label: 'fx.port.shape', type: 'select', default: 'ellipse', options: [{ value: 'ellipse', label: 'shape.ellipse' }, { value: 'rect', label: 'shape.rect' }, { value: 'linear', label: 'gradient.linear' }], inlineOnly: true },
      n('size', 'fx.port.size', 0.8, 0, 2, 0.01), n('feather', 'fx.port.feather', 0.2, 0, 1, 0.01), { id: 'invert', label: 'fx.port.invert', type: 'boolean', default: false }],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      const src: Canvas | null = i.image;
      if (!src) return { image: null };
      const w = src.width, h = src.height;
      const mask = ctx.pool.acquire(w, h);
      const mc = ctx2d(mask);
      const size = num(i.size, 0.8), feather = Math.max(0.001, num(i.feather, 0.2));
      if (i.shape === 'linear') {
        const g = mc.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(Math.max(0, Math.min(1, size - feather / 2)), 'rgba(0,0,0,1)');
        g.addColorStop(Math.max(0, Math.min(1, size + feather / 2)), 'rgba(0,0,0,0)');
        mc.fillStyle = g;
        mc.fillRect(0, 0, w, h);
      } else if (i.shape === 'rect') {
        mc.filter = `blur(${feather * Math.min(w, h) * 0.25}px)`;
        mc.fillStyle = '#000';
        mc.fillRect(w * (1 - size) / 2, h * (1 - size) / 2, w * size, h * size);
        mc.filter = 'none';
      } else {
        mc.save();
        mc.translate(w / 2, h / 2);
        mc.scale(w / 2, h / 2);
        const g = mc.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.01, size));
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(Math.max(0, 1 - feather), 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        mc.fillStyle = g;
        mc.fillRect(-1, -1, 2, 2);
        mc.restore();
      }
      const out = ctx.pool.acquire(w, h);
      const c = ctx2d(out);
      c.drawImage(src as any, 0, 0);
      c.globalCompositeOperation = i.invert ? 'destination-out' : 'destination-in';
      c.drawImage(mask as any, 0, 0);
      return { image: out };
    } });
  R({ id: 'fx.shader', label: 'fx.shader', category: 'filter', animated: true,
    inputs: [img(), { id: 'code', label: 'fx.port.code', type: 'string', inlineOnly: true, default: 'uniform float a;\nvoid main(){\n  vec4 c = texture2D(u_image, uv);\n  gl_FragColor = vec4(c.rgb * (0.6 + 0.4 * sin(u_time * 2.0 + uv.x * 6.0 + a)), c.a);\n}' },
      n('a', 'A', 0, -100, 100, 0.1), n('b', 'B', 0, -100, 100, 0.1), n('c', 'C', 0, -100, 100, 0.1), n('d', 'D', 0, -100, 100, 0.1)],
    outputs: OUT_IMG,
    evaluate(ctx, i) {
      if (!i.image) return { image: null };
      const code = String(i.code || '');
      const out = ctx.shaders.run(ctx.pool, code, i.image, { a: num(i.a), b: num(i.b), c: num(i.c), d: num(i.d) }, ctx.time);
      const err = ctx.shaders.compileError(code);
      if (err) ctx.errors.push(`Shader: ${err.split('\n')[0]}`);
      return { image: out };
    } });

  /* Values ------------------------------------------------------------------- */
  const V = { id: 'value', label: 'fx.port.value', type: 'number' as const };
  R({ id: 'fx.time', label: 'fx.time', category: 'value', animated: true, inputs: [n('speed', 'fx.port.speed', 1, -100, 100, 0.1)], outputs: [{ ...V, label: 'fx.port.seconds' }],
    evaluate: (ctx, i) => ({ value: ctx.time * num(i.speed, 1) }) });
  R({ id: 'fx.number', label: 'fx.number', category: 'value', inputs: [n('value', 'fx.port.value', 1, -1e6, 1e6, 0.1)], outputs: [V],
    evaluate: (_c, i) => ({ value: num(i.value) }) });
  R({ id: 'fx.param', label: 'fx.param', category: 'value', inputs: [{ id: 'param', label: 'fx.port.param', type: 'string', inlineOnly: true, default: '' }], outputs: [V],
    evaluate: (ctx, i) => ({ value: num(ctx.params?.[i.param]) }) });
  R({ id: 'fx.math', label: 'fx.math', category: 'math',
    inputs: [n('a', 'A', 0, -1e6, 1e6, 0.1), n('b', 'B', 1, -1e6, 1e6, 0.1), { id: 'op', label: 'fx.port.op', type: 'select', default: 'multiply', inlineOnly: true,
      options: ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'power', 'modulo', 'sin', 'cos', 'abs', 'round'].map((o) => ({ value: o, label: `op.${o}` })) }],
    outputs: [V],
    evaluate(_c, i) {
      const a = num(i.a), b = num(i.b);
      const r: Record<string, number> = { add: a + b, subtract: a - b, multiply: a * b, divide: b ? a / b : 0, min: Math.min(a, b), max: Math.max(a, b), power: Math.pow(a, b), modulo: b ? a % b : 0, sin: Math.sin(a) * b, cos: Math.cos(a) * b, abs: Math.abs(a), round: Math.round(a) };
      return { value: r[i.op] ?? a };
    } });
  R({ id: 'fx.oscillator', label: 'fx.oscillator', category: 'math', animated: true,
    inputs: [n('frequency', 'fx.port.frequency', 0.5, 0, 50, 0.05), n('amplitude', 'fx.port.amplitude', 1, -1e4, 1e4, 0.1), n('offset', 'fx.port.offset', 0, -1e4, 1e4, 0.1), n('phase', 'fx.port.phase', 0, 0, 1, 0.01),
      { id: 'wave', label: 'fx.port.wave', type: 'select', default: 'sine', inlineOnly: true, options: ['sine', 'triangle', 'square', 'saw'].map((w) => ({ value: w, label: `wave.${w}` })) }],
    outputs: [V],
    evaluate(ctx, i) {
      const ph = (ctx.time * num(i.frequency, 0.5) + num(i.phase)) % 1;
      const w = i.wave === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : i.wave === 'square' ? (ph < 0.5 ? 1 : -1) : i.wave === 'saw' ? ph * 2 - 1 : Math.sin(ph * Math.PI * 2);
      return { value: num(i.offset) + w * num(i.amplitude, 1) };
    } });
  R({ id: 'fx.mapRange', label: 'fx.mapRange', category: 'math',
    inputs: [n('value', 'fx.port.value', 0, -1e6, 1e6, 0.1), n('inMin', 'fx.port.inMin', 0, -1e6, 1e6), n('inMax', 'fx.port.inMax', 1, -1e6, 1e6), n('outMin', 'fx.port.outMin', 0, -1e6, 1e6), n('outMax', 'fx.port.outMax', 1, -1e6, 1e6), { id: 'clamp', label: 'fx.port.clamp', type: 'boolean', default: true }],
    outputs: [V],
    evaluate(_c, i) {
      const span = num(i.inMax, 1) - num(i.inMin);
      let u = span ? (num(i.value) - num(i.inMin)) / span : 0;
      if (i.clamp !== false) u = Math.max(0, Math.min(1, u));
      return { value: num(i.outMin) + u * (num(i.outMax, 1) - num(i.outMin)) };
    } });
  R({ id: 'fx.smoothNoise', label: 'fx.smoothNoise', category: 'math', animated: true, inputs: [n('speed', 'fx.port.speed', 1, 0, 50, 0.1), n('seed', 'fx.port.seed', 1, 0, 1000, 1), n('amplitude', 'fx.port.amplitude', 1, -1e4, 1e4, 0.1)], outputs: [V],
    evaluate(ctx, i) {
      const x = ctx.time * num(i.speed, 1) + num(i.seed) * 13.37;
      const h = (k: number) => { const s = Math.sin(k * 127.1 + num(i.seed) * 3.1) * 43758.5453; return s - Math.floor(s); };
      const k = Math.floor(x), f = x - k, u = f * f * (3 - 2 * f);
      return { value: ((h(k) * (1 - u) + h(k + 1) * u) * 2 - 1) * num(i.amplitude, 1) };
    } });
  R({ id: 'fx.variable', label: 'fx.variable', category: 'value', inputs: [{ id: 'variable', label: 'fx.port.variable', type: 'variable', inlineOnly: true, default: '' }], outputs: [V],
    evaluate: (ctx, i) => { const v = ctx.vars.get(i.variable); return { value: typeof v === 'boolean' ? (v ? 1 : 0) : num(v) }; } });
  R({ id: 'fx.layerProp', label: 'fx.layerProp', category: 'value',
    inputs: [{ id: 'layer', label: 'fx.port.layer', type: 'layer', inlineOnly: true, default: '' }, { id: 'prop', label: 'fx.port.prop', type: 'prop', inlineOnly: true, default: 'x' }],
    outputs: [V],
    evaluate(ctx, i) {
      const p = ctx.layerProps(i.layer || ctx.selfId) || ctx.selfProps;
      return { value: num(p?.[i.prop]) };
    } });
  R({ id: 'fx.color', label: 'fx.color', category: 'value', inputs: [{ id: 'color', label: 'fx.port.color', type: 'color', default: '#ffffff' }], outputs: [{ id: 'color', label: 'fx.port.color', type: 'color' }],
    evaluate: (_c, i) => ({ color: i.color }) });
  R({ id: 'fx.mixColor', label: 'fx.mixColor', category: 'math',
    inputs: [{ id: 'a', label: 'fx.port.colorA', type: 'color', default: '#ffffff' }, { id: 'b', label: 'fx.port.colorB', type: 'color', default: '#ff4060' }, n('t', 'fx.port.mix', 0.5, 0, 1, 0.01)],
    outputs: [{ id: 'color', label: 'fx.port.color', type: 'color' }],
    evaluate: (_c, i) => ({ color: lerpColor(i.a, i.b, Math.max(0, Math.min(1, num(i.t, 0.5)))) }) });

  /* Drivers -------------------------------------------------------------------- */
  R({ id: 'fx.drive', label: 'fx.drive', category: 'drive',
    inputs: [{ id: 'value', label: 'fx.port.value', type: 'number', default: 0 }, { id: 'layer', label: 'fx.port.targetLayer', type: 'layer', inlineOnly: true, default: '' }, { id: 'prop', label: 'fx.port.prop', type: 'prop', inlineOnly: true, default: 'rotation' }],
    outputs: [],
    evaluate(ctx, i) { if (i.prop) ctx.drive(i.layer || ctx.selfId, i.prop, i.value); return {}; } });
  R({ id: 'fx.driveColor', label: 'fx.driveColor', category: 'drive',
    inputs: [{ id: 'color', label: 'fx.port.color', type: 'color', default: '#ffffff' }, { id: 'layer', label: 'fx.port.targetLayer', type: 'layer', inlineOnly: true, default: '' }, { id: 'prop', label: 'fx.port.prop', type: 'prop', inlineOnly: true, default: 'color' }],
    outputs: [],
    evaluate(ctx, i) { if (i.prop) ctx.drive(i.layer || ctx.selfId, i.prop, i.color); return {}; } });
}

/** Effect presets offered by the editor. Each returns a fresh graph. */
export const EFFECT_PRESETS: Record<string, () => { nodes: any[]; edges: any[] }> = {};
