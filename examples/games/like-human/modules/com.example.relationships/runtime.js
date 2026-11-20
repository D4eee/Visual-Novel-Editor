// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * A gameplay module: a long-lived "system" (state + HUD) plus the blocks,
 * story node, scene component and expression function that use it.
 * Settings are stored in project.extensions["com.example.relationships"]
 * by the editor panel (editor.js).
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  const SYSTEM = `${api.id}/affection`;
  /** @type {any} */
  let current = null;
  /** @param {import('../../../sdk/types').Project} project */
  const settings = (project) => /** @type {{ characters: Record<string, { tracked: boolean; start: number; max: number; threshold: number }>; showMeter: boolean }} */ (
    project.extensions?.[api.id] || { characters: {}, showMeter: true });

  api.systems.register({
    id: 'affection',
    label: 'rel.system',
    create(game) {
      const cfg = settings(game.project);
      /** @type {Record<string, number>} */
      let values = {};
      const reset = () => { values = {}; for (const [id, c] of Object.entries(cfg.characters)) if (c.tracked) values[id] = Number(c.start) || 0; };
      reset();
      // HUD: a small heart meter that appears briefly when affection changes.
      const hud = document.createElement('div');
      Object.assign(hud.style, { position: 'absolute', left: '28px', top: '24px', display: 'flex', flexDirection: 'column', gap: '8px', opacity: '0', transition: 'opacity .35s', pointerEvents: 'none', font: '600 18px system-ui, sans-serif', color: '#fff' });
      game.hud.append(hud);
      let hideTimer = 0;
      const show = (charId) => {
        if (!cfg.showMeter) return;
        const ch = game.project.characters.find((c) => c.id === charId);
        const c = cfg.characters[charId];
        if (!ch || !c) return;
        hud.innerHTML = '';
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderRadius: '12px', background: 'rgba(15,16,26,.78)', border: `1px solid ${ch.color}` });
        const name = document.createElement('span');
        name.textContent = ch.name;
        name.style.color = ch.color;
        const hearts = document.createElement('span');
        const max = Math.max(1, Number(c.max) || 10);
        const full = Math.round((values[charId] / max) * 5);
        hearts.textContent = '♥'.repeat(Math.max(0, Math.min(5, full))) + '♡'.repeat(Math.max(0, 5 - Math.max(0, full)));
        hearts.style.color = '#ff7aa8';
        hearts.style.letterSpacing = '3px';
        row.append(name, hearts);
        hud.append(row);
        hud.style.opacity = '1';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => (hud.style.opacity = '0'), 2200);
      };
      const instance = {
        get(charId) { return values[charId] ?? 0; },
        byName(name) { const ch = game.project.characters.find((c) => c.name === name); return ch ? values[ch.id] ?? 0 : 0; },
        change(charId, delta) {
          const c = cfg.characters[charId];
          const max = c ? Number(c.max) || 10 : 10;
          const before = values[charId] ?? 0;
          values[charId] = Math.max(0, Math.min(max, before + Number(delta)));
          const event = { type: 'affection.changed', characterId: charId, value: values[charId], previous: before };
          // Scene dispatch reaches script hats and is forwarded to game.events; outside scenes emit directly.
          if (game.scene) game.scene.dispatch(event); else game.events.emit(event.type, event);
          show(charId);
          game.debugLog(`♥ ${charId}: ${before} → ${values[charId]}`);
        },
        threshold(charId) { return Number(cfg.characters[charId]?.threshold ?? 6); },
        save() { return { values }; },
        load(data) { values = { ...(/** @type {any} */ (data)?.values || {}) }; },
        dispose() { hud.remove(); clearTimeout(hideTimer); if (current === instance) current = null; },
      };
      current = instance;
      return instance;
    },
  });

  const sys = (ctx) => ctx.runtime.system(SYSTEM);

  api.blocks.register({
    id: 'change',
    category: 'variables',
    shape: 'statement',
    label: 'rel.block.change',
    color: '#ff6f9f',
    args: [{ id: 'character', type: 'character' }, { id: 'delta', type: 'number', default: 1 }],
    run(ctx, a) { if (a.character) sys(ctx)?.change(a.character, a.delta); },
  });

  api.blocks.register({
    id: 'whenReaches',
    category: 'events',
    shape: 'hat',
    label: 'rel.block.whenReaches',
    color: '#ff6f9f',
    event: 'affection.changed',
    args: [{ id: 'character', type: 'character' }, { id: 'value', type: 'number', default: 5 }],
    matches: (e, a) => e.characterId === a.character && Number(e.value) >= Number(a.value),
  });

  api.nodes.register({
    id: 'branch',
    label: 'rel.node.branch',
    category: 'module',
    color: '#ff6f9f',
    icon: 'users',
    description: 'rel.node.branch.desc',
    workspace: 'logic',
    createData: () => ({ characterId: null, threshold: null }),
    inputs: () => [{ id: 'in', type: 'flow', multiple: true }],
    outputs: () => [{ id: 'high', label: 'rel.port.high', type: 'flow' }, { id: 'low', label: 'rel.port.low', type: 'flow' }],
    props: [
      { key: 'characterId', type: 'character', label: 'rel.prop.character' },
      { key: 'threshold', type: 'number', label: 'rel.prop.threshold', description: 'rel.prop.threshold.desc', min: 0, step: 1 },
    ],
    summary: (n, p) => { const c = p.characters.find((x) => x.id === n.data.characterId); return c ? `${c.name} ≥ ${n.data.threshold ?? '★'}` : ''; },
    run(node, ctx) {
      const s = ctx.runtime.system(SYSTEM);
      if (!s || !node.data.characterId) return 'low';
      const th = node.data.threshold === null || node.data.threshold === undefined || node.data.threshold === '' ? s.threshold(node.data.characterId) : Number(node.data.threshold);
      return s.get(node.data.characterId) >= th ? 'high' : 'low';
    },
    validate(node) {
      return node.data.characterId ? [] : [{ severity: 'warning', code: 'rel.noChar', message: 'rel.issue.noChar' }];
    },
  });

  api.components.register({
    id: 'onEnter',
    label: 'rel.comp.onEnter',
    description: 'rel.comp.onEnter.desc',
    icon: 'users',
    nodeTypes: ['core.scene'],
    multiple: true,
    props: [
      { key: 'characterId', type: 'character', label: 'rel.prop.character' },
      { key: 'delta', type: 'number', label: 'rel.prop.delta', default: 1, step: 1 },
    ],
    sceneEnter(ctx, data) {
      if (data.characterId) ctx.runtime.system(SYSTEM)?.change(data.characterId, data.delta);
    },
  });

  // Usable in conditions and expressions: affection("Mika") >= 5
  // Functions are called by their local name. The running game's system is
  // remembered in `current` while a game (preview or exported) is active.
  api.functions.register({ id: 'affection', label: 'affection', args: 1, fn: (name) => current?.byName(String(name)) ?? 0 });
}
