// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * A custom layer type. Transform properties (position, scale, rotation,
 * opacity…) are added automatically for visual layers, so this module only
 * declares its own properties and how to draw them.
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  /** @param {CanvasRenderingContext2D} ctx */
  function wrap(ctx, text, maxWidth) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      // Break on spaces for Latin text and between any characters for CJK.
      const tokens = para.match(/[぀-鿿＀-￯]|[^\s぀-鿿＀-￯]+\s*|\s+/g) || [''];
      for (const tok of tokens) {
        const test = line + tok;
        if (ctx.measureText(test).width > maxWidth && line) { lines.push(line.trimEnd()); line = tok.trimStart(); }
        else line = test;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  api.layers.register({
    id: 'bubble',
    label: 'bubble.layer',
    icon: 'message',
    category: 'text',
    visual: true,
    props: [
      { key: 'text', type: 'text', label: 'bubble.text', default: 'Hey! Over here!' },
      { key: 'width', type: 'number', label: 'bubble.width', default: 320, min: 60, unit: 'px', animatable: true, group: 'bubble' },
      { key: 'fontSize', type: 'number', label: 'bubble.fontSize', default: 26, min: 8, animatable: true, group: 'bubble' },
      { key: 'fill', type: 'color', label: 'bubble.fill', default: '#ffffff', animatable: true, group: 'bubble' },
      { key: 'textColor', type: 'color', label: 'bubble.textColor', default: '#1d1d27', animatable: true, group: 'bubble' },
      { key: 'tail', type: 'select', label: 'bubble.tail', default: 'bottomLeft', group: 'bubble',
        options: [{ value: 'bottomLeft', label: 'bubble.tail.bl' }, { value: 'bottomRight', label: 'bubble.tail.br' }, { value: 'none', label: 'bubble.tail.none' }] },
      { key: 'style', type: 'select', label: 'bubble.style', default: 'speech', group: 'bubble',
        options: [{ value: 'speech', label: 'bubble.style.speech' }, { value: 'thought', label: 'bubble.style.thought' }, { value: 'shout', label: 'bubble.style.shout' }] },
      // An animatable property used for a "pop" entrance: 0 = hidden, 1 = full size.
      { key: 'pop', type: 'number', label: 'bubble.pop', default: 1, min: 0, max: 1.3, step: 0.01, animatable: true, group: 'bubble', description: 'bubble.pop.desc' },
    ],
    defaults: () => ({ anchorX: 0.1, anchorY: 1 }),
    size(_layer, p, rc) {
      const ctx = rc.measure;
      ctx.font = `600 ${p.fontSize}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      const pad = p.fontSize * 0.8;
      const lines = wrap(ctx, p.text, Math.max(20, p.width - pad * 2));
      return { width: p.width, height: lines.length * p.fontSize * 1.35 + pad * 2 + (p.tail === 'none' ? 0 : p.fontSize) };
    },
    draw(rc, _layer, p) {
      const ctx = rc.ctx;
      ctx.font = `600 ${p.fontSize}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      const pad = p.fontSize * 0.8;
      const lines = wrap(ctx, p.text, Math.max(20, p.width - pad * 2));
      const w = p.width;
      const h = lines.length * p.fontSize * 1.35 + pad * 2;
      const tail = p.tail === 'none' ? 0 : p.fontSize;
      const pop = Math.max(0, Number(p.pop));
      if (pop <= 0) return;
      ctx.save();
      // Scale from the tail tip so the bubble grows out of the speaker.
      const tipX = p.tail === 'bottomRight' ? w * 0.8 : w * 0.2;
      ctx.translate(tipX, h + tail);
      ctx.scale(pop, pop);
      ctx.translate(-tipX, -(h + tail));
      ctx.fillStyle = p.fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = Math.max(2, p.fontSize / 10);
      ctx.beginPath();
      if (p.style === 'thought') {
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      } else if (p.style === 'shout') {
        const spikes = 18;
        for (let i = 0; i <= spikes; i++) {
          const a = (i / spikes) * Math.PI * 2;
          const r = i % 2 ? 0.92 : 1.08;
          const x = w / 2 + Math.cos(a) * (w / 2) * r, y = h / 2 + Math.sin(a) * (h / 2) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {
        const r = Math.min(h / 2, p.fontSize);
        ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (tail) {
        ctx.beginPath();
        if (p.style === 'thought') {
          ctx.arc(tipX, h + tail * 0.3, tail * 0.28, 0, Math.PI * 2);
          ctx.moveTo(tipX + tail * 0.15, h + tail * 0.85);
          ctx.arc(tipX, h + tail * 0.85, tail * 0.15, 0, Math.PI * 2);
        } else {
          ctx.moveTo(tipX - tail * 0.5, h - 2);
          ctx.lineTo(tipX, h + tail);
          ctx.lineTo(tipX + tail * 0.5, h - 2);
        }
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = p.textColor;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      lines.forEach((line, i) => ctx.fillText(line, w / 2, pad + i * p.fontSize * 1.35));
      ctx.restore();
    },
  });
}
