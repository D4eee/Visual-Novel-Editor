// @ts-check
/// <reference path="./vendor/vne-sdk.d.ts" />
import { h, ui } from './vendor/vne-sdk.js';

/**
 * Editor entry (optional). Runs only in the editor and is NOT included in
 * exported games. Add panels, inspectors, node workspaces, toolbar buttons,
 * importers or exporters here.
 *
 * @param {import('./vendor/vne-sdk').EditorApi} api
 */
export function activateEditor(api) {
  api.panels.register({
    id: 'panel',
    title: 'my.panel',
    icon: 'module',
    location: 'sidebar',
    mount(el, ctx) {
      const render = () => {
        const data = /** @type {{ greeting?: string }} */ (ctx.project().extensions?.[api.id] || {});
        el.innerHTML = '';
        el.style.padding = '8px 14px';
        el.append(
          h('p', { class: 'muted small' }, ctx.t('my.panelIntro')),
          ui.field(ctx.t('my.greeting'), ui.text(data.greeting || '', (v) => ctx.update(ctx.t('my.greeting'), (d) => { d.extensions[api.id] = { ...data, greeting: v }; }))),
        );
      };
      render();
      return ctx.onChange(render); // returning a function = cleanup when the panel closes
    },
  });
}
