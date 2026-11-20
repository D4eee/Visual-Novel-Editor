import type { Engine } from '@vne/core';
import { cubicBezier, num } from '../math';

export function registerBuiltinBasics(engine: Engine): void {
  /* Port types ---------------------------------------------------------- */
  engine.portTypes.register({ id: 'flow', label: 'port.flow', color: '#e8e6f0', kind: 'flow' });
  engine.portTypes.register({ id: 'number', label: 'port.number', color: '#6cc4ff', kind: 'data', accepts: ['boolean'] });
  engine.portTypes.register({ id: 'string', label: 'port.string', color: '#f6a35f', kind: 'data', accepts: ['number', 'boolean'] });
  engine.portTypes.register({ id: 'boolean', label: 'port.boolean', color: '#c48cff', kind: 'data', accepts: ['number'] });
  engine.portTypes.register({ id: 'any', label: 'port.any', color: '#9aa0b4', kind: 'data', accepts: ['*'] });

  /* Interpolators ------------------------------------------------------- */
  const I = (id: string, label: string, ease: (t: number, k?: any) => number, discrete = false) => engine.interpolators.register({ id, label, ease, discrete });
  I('linear', 'ease.linear', (t) => t);
  I('step', 'ease.step', () => 0, true);
  I('easeIn', 'ease.in', (t) => t * t * t);
  I('easeOut', 'ease.out', (t) => 1 - Math.pow(1 - t, 3));
  I('easeInOut', 'ease.inOut', (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2));
  I('backOut', 'ease.backOut', (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); });
  I('elastic', 'ease.elastic', (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1));
  I('bounce', 'ease.bounce', (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  });
  I('bezier', 'ease.bezier', (t, k) => {
    const b = k?.bez || [0.25, 0.1, 0.25, 1];
    return cubicBezier(b[0], b[1], b[2], b[3], t);
  });

  /* Transitions --------------------------------------------------------- */
  const T = engine.transitions;
  T.register({ id: 'none', label: 'transition.none', draw(ctx, _f, to) { ctx.drawImage(to, 0, 0); } });
  T.register({
    id: 'fade', label: 'transition.fade', params: [{ key: 'color', type: 'color', label: 'prop.color', default: '#000000' }],
    draw(ctx, from, to, p, params) {
      const w = to.width, h = to.height;
      ctx.fillStyle = params.color || '#000';
      if (p < 0.5) { ctx.drawImage(from, 0, 0); ctx.globalAlpha = p * 2; ctx.fillRect(0, 0, w, h); }
      else { ctx.drawImage(to, 0, 0); ctx.globalAlpha = (1 - p) * 2; ctx.fillRect(0, 0, w, h); }
      ctx.globalAlpha = 1;
    },
  });
  T.register({ id: 'dissolve', label: 'transition.dissolve', draw(ctx, from, to, p) { ctx.drawImage(from, 0, 0); ctx.globalAlpha = p; ctx.drawImage(to, 0, 0); ctx.globalAlpha = 1; } });
  T.register({
    id: 'slide', label: 'transition.slide', params: [{ key: 'direction', type: 'select', label: 'prop.direction', default: 'left', options: [{ value: 'left', label: 'dir.left' }, { value: 'right', label: 'dir.right' }, { value: 'up', label: 'dir.up' }, { value: 'down', label: 'dir.down' }] }],
    draw(ctx, from, to, p, params) {
      const w = to.width, h = to.height;
      const e = 1 - Math.pow(1 - p, 3);
      const d = params.direction || 'left';
      const dx = d === 'left' ? -w : d === 'right' ? w : 0;
      const dy = d === 'up' ? -h : d === 'down' ? h : 0;
      ctx.drawImage(from, dx * e, dy * e);
      ctx.drawImage(to, dx * (e - 1), dy * (e - 1));
    },
  });
  T.register({
    id: 'wipe', label: 'transition.wipe', params: [{ key: 'softness', type: 'number', label: 'prop.softness', default: 0.15, min: 0, max: 1 }],
    draw(ctx, from, to, p, params) {
      const w = to.width, h = to.height;
      const soft = Math.max(0.001, num(params.softness, 0.15)) * w;
      ctx.drawImage(from, 0, 0);
      const x = -soft + (w + soft * 2) * p;
      ctx.save();
      const g = ctx.createLinearGradient(x - soft, 0, x + soft, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      // Draw `to` masked by the gradient using a temporary layer
      const tmp = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h);
      tmp.width = w; tmp.height = h;
      const t = tmp.getContext('2d') as CanvasRenderingContext2D;
      t.drawImage(to, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.fillStyle = g;
      t.fillRect(0, 0, w, h);
      ctx.drawImage(tmp as any, 0, 0);
      ctx.restore();
    },
  });
  T.register({
    id: 'zoom', label: 'transition.zoom',
    draw(ctx, from, to, p) {
      const w = to.width, h = to.height;
      ctx.drawImage(from, 0, 0);
      const s = 1.15 - 0.15 * p;
      ctx.globalAlpha = p;
      ctx.drawImage(to, (w - w * s) / 2, (h - h * s) / 2, w * s, h * s);
      ctx.globalAlpha = 1;
    },
  });
  T.register({
    id: 'blinds', label: 'transition.blinds', params: [{ key: 'count', type: 'number', label: 'prop.count', default: 10, min: 2, max: 60 }],
    draw(ctx, from, to, p, params) {
      const w = to.width, h = to.height;
      const n = Math.max(2, Math.floor(num(params.count, 10)));
      ctx.drawImage(from, 0, 0);
      const bh = h / n;
      for (let i = 0; i < n; i++) {
        const local = Math.max(0, Math.min(1, p * 1.4 - (i / n) * 0.4));
        const hh = bh * local;
        if (hh > 0) ctx.drawImage(to, 0, i * bh, w, hh, 0, i * bh, w, hh);
      }
    },
  });
}
