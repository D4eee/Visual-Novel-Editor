// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * Custom animated properties. They appear in every visual layer's inspector
 * with ◆ keyframe buttons and can be animated on the timeline, set from
 * scripts ("Set wobble of …") or driven by effect graphs.
 *
 * The `apply` hook runs while the layer is drawn, in the layer's local space,
 * so changing the transform here bends the layer without touching its data.
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  api.properties.register({
    id: 'wobble',
    layerTypes: '*',
    prop: { key: 'wobble', type: 'number', label: 'wobble.prop', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'wobble', description: 'wobble.prop.desc' },
    phase: 'transform',
    apply(rc, _layer, _props, value) {
      const amount = Number(value) || 0;
      if (!amount) return;
      const t = rc.time * 9;
      const w = rc.width ?? 200, h = rc.height ?? 200; // size of the layer being drawn
      const sx = 1 + Math.sin(t) * 0.08 * amount, sy = 1 - Math.sin(t) * 0.08 * amount;
      // squash around the bottom center
      rc.ctx.translate(w / 2, h);
      rc.ctx.scale(sx, sy);
      rc.ctx.translate(-w / 2, -h);
    },
  });

  api.properties.register({
    id: 'float',
    layerTypes: '*',
    prop: { key: 'float', type: 'number', label: 'float.prop', default: 0, min: 0, max: 60, step: 1, unit: 'px', animatable: true, group: 'wobble', description: 'float.prop.desc' },
    phase: 'transform',
    apply(rc, _layer, _props, value) {
      const px = Number(value) || 0;
      if (px) rc.ctx.translate(0, Math.sin(rc.time * 1.6) * px);
    },
  });

  // A custom keyframe interpolation curve shows up in the timeline's interpolation menu.
  api.interpolators.register({ id: 'smoothstep', label: 'wobble.ease', ease: (t) => t * t * t * (t * (t * 6 - 15) + 10) });
}
