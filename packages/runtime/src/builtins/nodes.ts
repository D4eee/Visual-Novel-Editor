import type { Engine, Project, StoryNode, SceneData, EventData, ConditionData, JumpData, EndingData, RandomData, WaitData, CommentData } from '@vne/core';
import { createSceneData, nextSceneNumber, nextJumpNumber, scenePorts, exprToString, newId, jumpOutsFor, sceneLines } from '@vne/core';
import { stripMarkup } from '../text';

const IN = [{ id: 'in', type: 'flow', multiple: true }];
const OUT = [{ id: 'out', type: 'flow' }];

export function varNameFn(project: Project) {
  return (id: string) => project.variables.find((v) => v.id === id)?.name || '?';
}

export function registerBuiltinNodes(engine: Engine): void {
  const R = engine.nodeTypes;

  R.register({
    id: 'core.start', label: 'node.start', category: 'flow', color: '#3ecf8e', icon: 'play', unique: true, creatable: true,
    description: 'node.start.desc',
    createData: () => ({}),
    inputs: () => [],
    outputs: () => OUT,
    run: () => 'out',
  });

  R.register({
    id: 'core.scene', label: 'node.scene', category: 'scene', color: '#6c8cff', icon: 'scene', creatable: true, workspace: 'scene',
    description: 'node.scene.desc',
    createData: (p) => createSceneData(nextSceneNumber(p)),
    inputs: () => IN,
    outputs: (n) => scenePorts(n.data as SceneData),
    summary(n) {
      const d = n.data as SceneData;
      const first = sceneLines(d)[0];
      return first ? stripMarkup(first.text).slice(0, 90) : '';
    },
    run: (node, ctx) => ctx.playScene(node),
  });

  R.register({
    id: 'core.event', label: 'node.event', category: 'logic', color: '#f2a65a', icon: 'bolt', creatable: true, workspace: 'logic',
    description: 'node.event.desc',
    createData: (): EventData => ({ actions: [] }),
    inputs: () => IN,
    outputs: () => OUT,
    summary: (n, _p, t) => {
      const a = (n.data as EventData).actions;
      return a.length ? a.map((b) => t(`block.short.${b.type}`) !== `block.short.${b.type}` ? t(`block.short.${b.type}`) : b.type.split('.').pop()).slice(0, 4).join(' · ') : '';
    },
    async run(node, ctx) {
      await ctx.runActions((node.data as EventData).actions, node.id);
      return 'out';
    },
  });

  R.register({
    id: 'core.condition', label: 'node.condition', category: 'logic', color: '#e06c9f', icon: 'branch', creatable: true, workspace: 'logic',
    description: 'node.condition.desc',
    createData: (): ConditionData => ({ expr: null }),
    inputs: () => IN,
    outputs: () => [{ id: 'true', type: 'flow', label: 'port.true' }, { id: 'false', type: 'flow', label: 'port.false' }],
    summary: (n, p) => exprToString((n.data as ConditionData).expr, varNameFn(p)),
    run: (node, ctx) => (ctx.evaluateBool((node.data as ConditionData).expr) ? 'true' : 'false'),
  });

  R.register({
    id: 'core.random', label: 'node.random', category: 'logic', color: '#b48cf0', icon: 'dice', creatable: true, workspace: 'logic',
    description: 'node.random.desc',
    createData: (): RandomData => ({ branches: [{ id: newId('br'), label: 'A', weight: 1 }, { id: newId('br'), label: 'B', weight: 1 }] }),
    inputs: () => IN,
    outputs: (n) => (n.data as RandomData).branches.map((b) => ({ id: b.id, type: 'flow', label: `${b.label} (${b.weight})` })),
    run(node, ctx) {
      const br = (node.data as RandomData).branches;
      const total = br.reduce((s, b) => s + Math.max(0, b.weight), 0);
      let r = ctx.random() * total;
      for (const b of br) { r -= Math.max(0, b.weight); if (r <= 0) return b.id; }
      return br[br.length - 1]?.id ?? null;
    },
  });

  R.register({
    id: 'core.wait', label: 'node.wait', category: 'logic', color: '#8fa3bf', icon: 'clock', creatable: true, workspace: 'logic',
    description: 'node.wait.desc',
    createData: (): WaitData => ({ seconds: 1 }),
    inputs: () => IN,
    outputs: () => OUT,
    summary: (n) => `${(n.data as WaitData).seconds}s`,
    async run(node, ctx) { await ctx.sleep((node.data as WaitData).seconds); return 'out'; },
  });

  R.register({
    id: 'core.jumpIn', label: 'node.jumpIn', category: 'flow', color: '#4fc3c8', icon: 'jumpIn', creatable: true,
    description: 'node.jumpIn.desc',
    createData: (p): JumpData => ({ number: nextJumpNumber(p) }),
    inputs: () => IN,
    outputs: () => [],
    summary: (n) => `#${(n.data as JumpData).number}`,
    run(node, ctx) {
      const outs = jumpOutsFor(ctx.project, (node.data as JumpData).number);
      if (!outs.length) throw new Error(`Jump In #${(node.data as JumpData).number} has no matching Jump Out`);
      if (outs.length > 1) ctx.warn(`Jump #${(node.data as JumpData).number} is ambiguous; using the first Jump Out`);
      return { goto: outs[0].id };
    },
  });

  R.register({
    id: 'core.jumpOut', label: 'node.jumpOut', category: 'flow', color: '#4fc3c8', icon: 'jumpOut', creatable: true,
    description: 'node.jumpOut.desc',
    createData: (p): JumpData => {
      // Default to the lowest Jump In number that has no Jump Out yet, so pairs are easy to make.
      const ins = Object.values(p.nodes).filter((x) => x.type === 'core.jumpIn').map((x) => (x.data as JumpData).number);
      const free = ins.filter((num) => !jumpOutsFor(p, num).length).sort((a, b) => a - b)[0];
      return { number: free ?? nextJumpNumber(p) };
    },
    inputs: () => [],
    outputs: () => OUT,
    summary: (n) => `#${(n.data as JumpData).number}`,
    run: () => 'out',
  });

  R.register({
    id: 'core.ending', label: 'node.ending', category: 'flow', color: '#ef5f6b', icon: 'flag', creatable: true, workspace: 'logic',
    description: 'node.ending.desc',
    createData: (): EndingData => ({ label: 'The End', behavior: 'title', message: '', unlockVarId: null }),
    inputs: () => IN,
    outputs: () => [],
    summary: (n) => (n.data as EndingData).label,
    async run(node, ctx) {
      await ctx.ending(node.data as EndingData);
      return { end: true };
    },
  });

  R.register({
    id: 'core.comment', label: 'node.comment', category: 'organize', color: '#5b6275', icon: 'note', creatable: true,
    description: 'node.comment.desc',
    createData: (): CommentData => ({ text: '', width: 320, height: 160 }),
    inputs: () => [],
    outputs: () => [],
    summary: (n) => (n.data as CommentData).text,
  });
}

export function isSceneNode(n: StoryNode | undefined): n is StoryNode<SceneData> {
  return !!n && n.type === 'core.scene';
}
