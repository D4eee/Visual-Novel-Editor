// @ts-check
/// <reference path="../../../sdk/types/index.d.ts" />

/**
 * Custom story nodes + a custom data port type.
 *
 *  [Roll Dice] --roll--> [Skill Check] --success--> …
 *                                      --failure--> …
 *
 * Data ports are pulled lazily: when Skill Check runs it asks for its "bonus"
 * input, which evaluates the connected Roll Dice node.
 *
 * @param {import('../../../sdk/types').RuntimeApi} api
 */
export function activate(api) {
  // A port type for dice results. It also accepts plain numbers.
  api.ports.register({ id: 'roll', label: 'dice.port.roll', color: '#ff9f43', kind: 'data', accepts: ['number'] });
  const ROLL = `${api.id}/roll`;

  const rollDie = (sides) => 1 + Math.floor(Math.random() * Math.max(2, sides));

  api.nodes.register({
    id: 'rollDice',
    label: 'dice.node.roll',
    category: 'module',
    color: '#ff9f43',
    icon: 'dice',
    description: 'dice.node.roll.desc',
    createData: () => ({ count: 1, sides: 20, modifierVar: null }),
    inputs: () => [],
    outputs: () => [{ id: 'roll', label: 'dice.port.roll', type: ROLL }],
    summary: (n) => `${n.data.count}d${n.data.sides}`,
    props: [
      { key: 'count', type: 'number', label: 'dice.prop.count', default: 1, min: 1, max: 10, step: 1 },
      { key: 'sides', type: 'number', label: 'dice.prop.sides', default: 20, min: 2, max: 100, step: 1 },
      { key: 'modifierVar', type: 'variable', label: 'dice.prop.modifier', description: 'dice.prop.modifier.desc' },
    ],
    workspace: 'logic',
    // Data node: evaluated when another node reads its output.
    evaluate(node, _port, ctx) {
      let total = 0;
      for (let i = 0; i < node.data.count; i++) total += rollDie(node.data.sides);
      if (node.data.modifierVar) total += Number(ctx.vars.get(node.data.modifierVar)) || 0;
      ctx.runtime.debugLog(`🎲 ${node.data.count}d${node.data.sides} → ${total}`);
      return total;
    },
  });

  api.nodes.register({
    id: 'skillCheck',
    label: 'dice.node.check',
    category: 'module',
    color: '#ff9f43',
    icon: 'dice',
    description: 'dice.node.check.desc',
    createData: () => ({ difficulty: 12, resultVar: null }),
    inputs: () => [{ id: 'in', type: 'flow', multiple: true }, { id: 'bonus', label: 'dice.port.bonus', type: ROLL }],
    outputs: () => [{ id: 'success', label: 'dice.port.success', type: 'flow' }, { id: 'failure', label: 'dice.port.failure', type: 'flow' }],
    summary: (n) => `DC ${n.data.difficulty}`,
    props: [
      { key: 'difficulty', type: 'number', label: 'dice.prop.difficulty', default: 12, min: 1, max: 100, step: 1 },
      { key: 'resultVar', type: 'variable', label: 'dice.prop.resultVar', description: 'dice.prop.resultVar.desc' },
    ],
    workspace: 'logic',
    async run(node, ctx) {
      // With nothing connected, roll a plain d20.
      const connected = await ctx.input('bonus');
      const roll = connected === undefined ? rollDie(20) : Number(connected);
      if (node.data.resultVar) ctx.vars.set(node.data.resultVar, roll);
      const ok = roll >= node.data.difficulty;
      ctx.runtime.toast(api.i18n.t(ok ? 'dice.toast.success' : 'dice.toast.failure', { roll, dc: node.data.difficulty }));
      return ok ? 'success' : 'failure';
    },
    validate(node) {
      if (node.data.difficulty > 20 * 10) return [{ severity: 'warning', code: 'dice.dc', message: 'dice.issue.dc' }];
      return [];
    },
  });
}
