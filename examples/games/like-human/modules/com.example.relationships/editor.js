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

  // An exporter (Export dialog → "Other exports"): a Markdown report of every
  // place in the story that reads or changes affection — handy for balancing routes.
  api.exporters.register({
    id: 'report',
    label: 'rel.report',
    run(ctx) {
      const p = ctx.project();
      const name = (id) => p.characters.find((c) => c.id === id)?.name || '?';
      const lines = [`# ${ctx.t('rel.report')} — ${p.name}`, ''];
      const walk = (blocks, where) => {
        for (const b of blocks || []) {
          if (b.type === `${api.id}/change`) lines.push(`- ${where}: ${name(b.args.character)} ${Number(b.args.delta) >= 0 ? '+' : ''}${b.args.delta}`);
          walk(b.body, where); walk(b.else, where);
        }
      };
      for (const n of Object.values(p.nodes)) {
        const chapter = p.chapters.find((c) => c.id === n.chapterId)?.name || '';
        const where = `${chapter} › ${n.name}`;
        if (n.type === `${api.id}/branch`) lines.push(`- ${where}: ${ctx.t('rel.node.branch')} (${name(n.data.characterId)} ≥ ${n.data.threshold ?? '★'})`);
        for (const m of n.modules || []) if (m.component === `${api.id}/onEnter` && m.enabled) lines.push(`- ${where}: ${ctx.t('rel.comp.onEnter')} ${name(m.data.characterId)} ${Number(m.data.delta) >= 0 ? '+' : ''}${m.data.delta}`);
        for (const st of n.data?.scripts || []) walk(st.body, where);
        walk(n.data?.actions, where);
      }
      if (lines.length === 2) lines.push(ctx.t('rel.report.empty'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/markdown' }));
      a.download = `${p.name} - affection.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      ctx.toast(ctx.t('rel.report.done'), 'success');
    },
  });
}
