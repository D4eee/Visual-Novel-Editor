// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * A node component: module data attached to a specific scene node.
 * Runtime hooks receive the instance's saved data.
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  api.components.register({
    id: 'timer',
    label: 'tc.label',
    description: 'tc.desc',
    icon: 'clock',
    nodeTypes: ['core.scene'],
    // The generated form is hidden in favour of the custom editor UI (editor.js),
    // but the schema still documents the data and provides defaults.
    props: [
      { key: 'seconds', type: 'number', label: 'tc.seconds', default: 8, min: 1, max: 60, step: 0.5, hidden: true },
      { key: 'defaultChoice', type: 'choice', label: 'tc.default', default: '', hidden: true },
      { key: 'color', type: 'color', label: 'tc.color', default: '#ffcc66', hidden: true },
    ],
    sceneEnter(ctx, data, state) {
      // Start counting when the choices appear (after the dialogue ends).
      state.off = ctx.on('dialogue.end', () => start(ctx, data, state));
      state.offChoice = ctx.on('choice.selected', () => stop(state));
    },
    sceneExit(_ctx, _data, state) {
      stop(state);
      state.off?.();
      state.offChoice?.();
    },
    frame(ctx, data, dt, state) {
      if (!state.running) return;
      state.left -= dt;
      const pct = Math.max(0, state.left / data.seconds);
      state.bar.style.transform = `scaleX(${pct})`;
      if (state.left <= 0) {
        stop(state);
        const list = ctx.scene.availableChoices().filter((c) => !c.disabled);
        const pick = list.find((c) => c.choice.id === data.defaultChoice) || list[list.length - 1];
        if (pick) ctx.scene.pickChoice(pick.choice.id);
      }
    },
    validate(data, node) {
      const choices = node.data.choices || [];
      if (!choices.length) return [{ severity: 'warning', code: 'tc.noChoices', message: 'tc.issue.noChoices' }];
      if (data.defaultChoice && !choices.some((c) => c.id === data.defaultChoice)) return [{ severity: 'error', code: 'tc.missing', message: 'tc.issue.missing' }];
      return [];
    },
  });

  function start(ctx, data, state) {
    if (state.running) return;
    state.running = true;
    state.left = Number(data.seconds) || 8;
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', left: '50%', top: '18%', width: '40%', height: '10px', transform: 'translateX(-50%)', borderRadius: '6px', background: 'rgba(0,0,0,.45)', overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,.4)' });
    const bar = document.createElement('div');
    Object.assign(bar.style, { width: '100%', height: '100%', background: data.color || '#ffcc66', transformOrigin: 'left center' });
    wrap.append(bar);
    ctx.runtime.hud.append(wrap);
    state.wrap = wrap;
    state.bar = bar;
  }

  function stop(state) {
    state.running = false;
    state.wrap?.remove();
    state.wrap = null;
  }
}
