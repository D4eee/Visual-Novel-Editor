// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />
import { h, ui } from './vendor/vne-sdk.js';

/**
 * Editor entry: an extra inspector section for bubble layers with one-click
 * style presets. Writes go through ctx.setLayerProps (undoable, keyframe-aware).
 *
 * @param {import('../../../sdk/types').EditorApi} api
 */
export function activateEditor(api) {
  const PRESETS = [
    { id: 'classic', props: { style: 'speech', fill: '#ffffff', textColor: '#1d1d27', tail: 'bottomLeft' } },
    { id: 'night', props: { style: 'speech', fill: '#1f2340', textColor: '#e8ecff', tail: 'bottomLeft' } },
    { id: 'thought', props: { style: 'thought', fill: '#f4f0ff', textColor: '#40306a', tail: 'bottomRight' } },
    { id: 'shout', props: { style: 'shout', fill: '#ffe066', textColor: '#3a1d00', tail: 'none' } },
  ];
  api.inspectors.register({
    id: 'styles',
    target: `${api.id}/bubble`,
    title: 'bubble.presets',
    mount(el, ctx) {
      el.append(
        h('div', { class: 'muted small', style: { marginBottom: '6px' } }, ctx.t('bubble.presets.hint')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
          ...PRESETS.map((p) => {
            const b = ui.button(ctx.t(`bubble.preset.${p.id}`), () => ctx.setLayerProps?.(p.props, ctx.t('bubble.presets')), { small: true });
            b.prepend(h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', marginRight: '6px', background: p.props.fill, border: '1px solid rgba(255,255,255,.3)' } }));
            return b;
          })),
      );
    },
  });
}
