// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />
import { h, ui } from './vendor/vne-sdk.js';

/**
 * Editor entry: a custom interface inside the scene node's Modules workspace.
 * It reads the node's choices so the default-choice picker always matches the
 * scene, and previews the countdown bar.
 *
 * @param {import('../../../sdk/types').EditorApi} api
 */
export function activateEditor(api) {
  api.nodeWorkspaces.register({
    id: 'timerUi',
    component: `${api.id}/timer`,
    mount(el, ctx) {
      const render = () => {
        const node = ctx.project().nodes[ctx.nodeId || ''];
        if (!node) return;
        const inst = node.modules.find((m) => m.id === ctx.instanceId);
        const data = /** @type {any} */ (inst?.data || {});
        const choices = (node.data.layers || []).filter((l) => l.type === 'core.choice').map((l) => ({ id: l.id, text: l.props.text }));
        el.innerHTML = '';
        const preview = h('div', { style: { height: '10px', borderRadius: '6px', background: 'rgba(255,255,255,.08)', overflow: 'hidden', margin: '6px 0 12px' } },
          h('div', { style: { width: '62%', height: '100%', background: data.color || '#ffcc66', animation: 'tcpreview 2.4s linear infinite' } }));
        el.append(
          h('style', null, '@keyframes tcpreview { from { width: 100% } to { width: 0% } }'),
          h('div', { class: 'muted small' }, ctx.t('tc.uiIntro')),
          preview,
          ui.field(ctx.t('tc.seconds'), ui.slider(Number(data.seconds ?? 8), (v) => ctx.setData?.({ seconds: v }, ctx.t('tc.label')), { min: 1, max: 30, step: 0.5 }), `${data.seconds ?? 8} s`),
          ui.field(ctx.t('tc.default'), ui.select(String(data.defaultChoice || ''), [{ value: '', label: ctx.t('tc.lastChoice') }, ...choices.map((c) => ({ value: c.id, label: c.text || '—' }))], (v) => ctx.setData?.({ defaultChoice: v }, ctx.t('tc.label')))),
          ui.field(ctx.t('tc.color'), ui.color(String(data.color || '#ffcc66'), (v) => ctx.setData?.({ color: v }, ctx.t('tc.label')))),
          choices.length ? null : h('div', { class: 'issue warning slim' }, ctx.t('tc.issue.noChoices')),
        );
      };
      render();
      return ctx.onChange(render);
    },
  });
}
