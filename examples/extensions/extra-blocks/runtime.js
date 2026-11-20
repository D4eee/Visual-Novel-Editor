// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * Custom visual-scripting blocks. Each block declares typed arguments; the
 * editor renders matching inputs (variable pickers, layer pickers, numbers…)
 * and evaluates expressions before calling run().
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  // A C-shaped block: its body runs with the given probability.
  api.blocks.register({
    id: 'chance',
    category: 'control',
    shape: 'c',
    label: 'xb.chance',
    color: '#c46ff0',
    args: [{ id: 'percent', type: 'number', default: 50 }],
    async run(ctx, a, block) {
      if (Math.random() * 100 < Number(a.percent)) await ctx.runBody(block.body);
    },
  });

  // A statement block using the game HUD.
  api.blocks.register({
    id: 'notify',
    category: 'looks',
    shape: 'statement',
    label: 'xb.notify',
    color: '#c46ff0',
    args: [{ id: 'text', type: 'string', default: 'Something changed…' }, { id: 'seconds', type: 'number', default: 2 }],
    async run(ctx, a) {
      const el = document.createElement('div');
      el.textContent = String(a.text);
      Object.assign(el.style, { position: 'absolute', right: '28px', top: '28px', padding: '12px 18px', borderRadius: '10px', background: 'rgba(20,22,35,.9)', color: '#fff', font: '600 20px system-ui, sans-serif', border: '1px solid rgba(255,255,255,.2)', transition: 'opacity .3s, transform .3s', transform: 'translateY(-8px)', opacity: '0' });
      ctx.runtime.hud.append(el);
      requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
      await ctx.wait(Number(a.seconds) || 2).catch(() => {});
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 350);
    },
  });

  // A hat block that fires when a variable reaches a value (from below).
  api.blocks.register({
    id: 'whenReaches',
    category: 'events',
    shape: 'hat',
    label: 'xb.whenReaches',
    color: '#c46ff0',
    event: 'var.changed',
    args: [{ id: 'variable', type: 'variable' }, { id: 'value', type: 'number', default: 3 }],
    matches: (e, a) => e.varId === a.variable && Number(e.value) >= Number(a.value),
  });

  // Expression function: random(…) already exists; this one returns a float.
  api.functions.register({ id: 'randomFloat', label: 'randomFloat', args: 2, fn: (a, b) => Number(a) + Math.random() * (Number(b) - Number(a)) });
}
