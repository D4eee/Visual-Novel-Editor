// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />
import { h, ui } from './vendor/vne-sdk.js';

/**
 * Editor entry: a sidebar panel to configure which characters have an
 * affection meter. Settings live in project.extensions[moduleId], are part of
 * undo/redo, and are exported with the game.
 *
 * @param {import('../../../sdk/types').EditorApi} api
 */
export function activateEditor(api) {
  api.panels.register({
    id: 'panel',
    title: 'rel.panel',
    icon: 'users',
    location: 'sidebar',
    mount(el, ctx) {
      const read = () => /** @type {any} */ (ctx.project().extensions?.[api.id] || { characters: {}, showMeter: true });
      const write = (fn, label = ctx.t('rel.panel')) => ctx.update(label, (d) => {
        const cur = JSON.parse(JSON.stringify(d.extensions[api.id] || { characters: {}, showMeter: true }));
        fn(cur);
        d.extensions[api.id] = cur;
      });
      const render = () => {
        const cfg = read();
        const project = ctx.project();
        el.innerHTML = '';
        el.style.padding = '4px 14px 16px';
        el.append(h('p', { class: 'muted small' }, ctx.t('rel.panel.intro')));
        el.append(ui.checkbox(cfg.showMeter !== false, (v) => write((c) => { c.showMeter = v; }), ctx.t('rel.showMeter')));
        if (!project.characters.length) { el.append(h('div', { class: 'muted small', style: { marginTop: '12px' } }, ctx.t('rel.noCharacters'))); return; }
        for (const ch of project.characters) {
          const c = cfg.characters[ch.id] || { tracked: false, start: 0, max: 10, threshold: 6 };
          const card = h('div', { class: 'char-card', style: { marginTop: '10px', padding: '8px 10px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h('span', { class: 'char-dot', style: { background: ch.color } }),
              h('b', { style: { flex: '1' } }, ch.name),
              ui.checkbox(!!c.tracked, (v) => write((x) => { x.characters[ch.id] = { ...c, tracked: v }; }), ctx.t('rel.track'))),
          );
          if (c.tracked) {
            card.append(
              ui.field(ctx.t('rel.start'), ui.number(c.start, (v) => write((x) => { x.characters[ch.id] = { ...c, start: v }; }), { min: 0 })),
              ui.field(ctx.t('rel.max'), ui.number(c.max, (v) => write((x) => { x.characters[ch.id] = { ...c, max: v }; }), { min: 1 })),
              ui.field(ctx.t('rel.threshold'), ui.number(c.threshold, (v) => write((x) => { x.characters[ch.id] = { ...c, threshold: v }; }), { min: 0 }), ctx.t('rel.threshold.hint')),
            );
          }
          el.append(card);
        }
        el.append(h('p', { class: 'muted small', style: { marginTop: '12px' } }, ctx.t('rel.panel.usage')));
      };
      render();
      return ctx.onChange(render);
    },
  });
}
