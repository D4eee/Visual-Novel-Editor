// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * Custom effect nodes for the procedural effect graph, and a transition.
 * Image values are canvases; get scratch canvases from ctx.pool so nothing is
 * allocated per frame. ctx.shaders.run() executes a GLSL fragment shader.
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  api.effects.register({
    id: 'scanlines',
    label: 'retro.scanlines',
    category: 'filter',
    animated: true,
    inputs: [
      { id: 'image', label: 'retro.image', type: 'image' },
      { id: 'spacing', label: 'retro.spacing', type: 'number', default: 4, min: 2, max: 24, step: 1 },
      { id: 'darkness', label: 'retro.darkness', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01 },
      { id: 'roll', label: 'retro.roll', type: 'number', default: 20, min: 0, max: 200, step: 1 },
    ],
    outputs: [{ id: 'image', label: 'retro.result', type: 'image' }],
    evaluate(ctx, i) {
      /** @type {HTMLCanvasElement | null} */
      const src = i.image;
      if (!src) return { image: null };
      const out = ctx.pool.acquire(src.width, src.height);
      const c = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
      c.drawImage(src, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(0,0,0,${i.darkness})`;
      const s = Math.max(2, Math.round(i.spacing));
      const offset = (ctx.time * i.roll) % s;
      for (let y = -s + offset; y < out.height; y += s) c.fillRect(0, y, out.width, Math.max(1, s / 2));
      return { image: out };
    },
  });

  const POSTERIZE = `uniform float levels; uniform float mixAmount;
void main(){ vec4 c = texture2D(u_image, uv); vec3 p = floor(c.rgb * levels + 0.5) / levels; gl_FragColor = vec4(mix(c.rgb, p, mixAmount), c.a); }`;
  api.effects.register({
    id: 'posterize',
    label: 'retro.posterize',
    category: 'color',
    inputs: [
      { id: 'image', label: 'retro.image', type: 'image' },
      { id: 'levels', label: 'retro.levels', type: 'number', default: 4, min: 2, max: 32, step: 1 },
      { id: 'mix', label: 'retro.mix', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    ],
    outputs: [{ id: 'image', label: 'retro.result', type: 'image' }],
    evaluate(ctx, i) {
      if (!i.image) return { image: null };
      return { image: ctx.shaders.run(ctx.pool, POSTERIZE, i.image, { levels: Number(i.levels), mixAmount: Number(i.mix) }, ctx.time) };
    },
  });

  api.transitions.register({
    id: 'pixels',
    label: 'retro.transition',
    params: [{ key: 'block', type: 'number', label: 'retro.block', default: 24, min: 4, max: 128 }],
    draw(ctx, from, to, p, params) {
      const w = /** @type {any} */ (to).width, h = /** @type {any} */ (to).height;
      const b = Math.max(4, Number(params.block) || 24);
      ctx.drawImage(from, 0, 0);
      // Deterministic pseudo-random order per block.
      for (let y = 0; y < h; y += b) for (let x = 0; x < w; x += b) {
        const r = Math.abs(Math.sin((x * 12.9898 + y * 78.233)) * 43758.5453) % 1;
        if (r < p) ctx.drawImage(to, x, y, b, b, x, y, b, b);
      }
    },
  });
}
