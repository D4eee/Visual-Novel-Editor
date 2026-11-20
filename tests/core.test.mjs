import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../dist/test/vne.mjs';

const engine = V.createEngine();

function sceneProject() {
  const p = V.createProject('Test');
  const ch = p.chapters[0].id;
  const start = V.createNode(engine, p, 'core.start', ch, 0, 0);
  const a = V.createNode(engine, p, 'core.scene', ch, 300, 0);
  const b = V.createNode(engine, p, 'core.scene', ch, 600, 0);
  return V.produce(p, (d) => {
    d.nodes[start.id] = start; d.nodes[a.id] = a; d.nodes[b.id] = b;
    V.connect(engine, d, { node: start.id, port: 'out' }, { node: a.id, port: 'in' });
    V.connect(engine, d, { node: a.id, port: 'next' }, { node: b.id, port: 'in' });
  });
}

test('produce is copy-on-write and keeps untouched branches shared', () => {
  const base = { a: { x: 1 }, b: { y: [1, 2] } };
  const next = V.produce(base, (d) => { d.a.x = 2; });
  assert.equal(base.a.x, 1);
  assert.equal(next.a.x, 2);
  assert.equal(next.b, base.b);
  assert.equal(V.produce(base, () => {}), base);
});

test('history undo / redo / merge', () => {
  const h = new V.History({ n: 0 });
  h.update('one', (d) => { d.n = 1; });
  h.update('typing', (d) => { d.n = 2; }, { mergeKey: 'k' });
  h.update('typing', (d) => { d.n = 3; }, { mergeKey: 'k' });
  assert.equal(h.state.n, 3);
  assert.equal(h.undo(), 'typing');
  assert.equal(h.state.n, 1);
  h.redo();
  assert.equal(h.state.n, 3);
  h.markSaved();
  assert.equal(h.dirty, false);
  h.undo();
  assert.equal(h.dirty, true);
});

test('connecting a single output replaces the old edge; incompatible ports are refused', () => {
  let p = sceneProject();
  const [, a, b] = Object.values(p.nodes);
  const c = V.createNode(engine, p, 'core.scene', p.chapters[0].id, 900, 0);
  p = V.produce(p, (d) => { d.nodes[c.id] = c; V.connect(engine, d, { node: a.id, port: 'next' }, { node: c.id, port: 'in' }); });
  const outs = V.outgoing(p, a.id, 'next');
  assert.equal(outs.length, 1);
  assert.equal(outs[0].to.node, c.id);
  assert.equal(V.canConnect(engine, p, { node: b.id, port: 'next' }, { node: a.id, port: 'next' }).ok, false, 'output to output is refused');
  assert.equal(V.canConnect(engine, p, { node: b.id, port: 'next' }, { node: a.id, port: 'in' }).ok, true, 'loops back to an earlier scene are allowed');
});

test('choices get their own outputs with stable ids; deleting a choice removes only its edge', () => {
  let p = sceneProject();
  const [, a, b] = Object.values(p.nodes);
  p = V.produce(p, (d) => {
    const before = d.nodes[a.id].data.choices.slice();
    d.nodes[a.id].data.choices.push({ id: 'c1', text: 'Left', condition: null, hidden: false, unavailable: 'hide', effects: [], animationId: null },
      { id: 'c2', text: 'Right', condition: null, hidden: false, unavailable: 'hide', effects: [], animationId: null });
    V.syncSceneChoiceEdges(d, a.id, before);
  });
  const ports = V.nodePorts(engine, p, p.nodes[a.id]).outputs.map((x) => x.id);
  assert.deepEqual(ports, ['c:c1', 'c:c2']);
  p = V.produce(p, (d) => {
    V.connect(engine, d, { node: a.id, port: 'c:c1' }, { node: b.id, port: 'in' });
    V.connect(engine, d, { node: a.id, port: 'c:c2' }, { node: b.id, port: 'in' });
  });
  p = V.produce(p, (d) => {
    const before = d.nodes[a.id].data.choices.slice();
    d.nodes[a.id].data.choices = d.nodes[a.id].data.choices.filter((c) => c.id !== 'c1');
    V.syncSceneChoiceEdges(d, a.id, before);
  });
  assert.deepEqual(V.outgoing(p, a.id).map((e) => e.from.port), ['c:c2']);
});

test('copy / paste gives new ids and keeps internal edges', () => {
  let p = sceneProject();
  const ids = Object.keys(p.nodes).slice(1);
  const clip = V.copyNodes(p, ids);
  let pasted;
  p = V.produce(p, (d) => { pasted = V.pasteNodes(d, clip, d.chapters[0].id, { x: 40, y: 40 }); });
  assert.equal(pasted.length, 2);
  assert.ok(pasted.every((id) => !ids.includes(id)));
  assert.equal(p.edges.filter((e) => pasted.includes(e.from.node) && pasted.includes(e.to.node)).length, 1);
});

test('validation reports unpaired jumps, empty conditions and unreachable nodes', () => {
  let p = sceneProject();
  const ch = p.chapters[0].id;
  const jin = V.createNode(engine, p, 'core.jumpIn', ch, 0, 300);
  const lone = V.createNode(engine, p, 'core.scene', ch, 0, 600);
  p = V.produce(p, (d) => { d.nodes[jin.id] = jin; d.nodes[lone.id] = lone; V.connect(engine, d, { node: Object.keys(d.nodes)[2], port: 'next' }, { node: jin.id, port: 'in' }); });
  const codes = V.validateProject(engine, p).map((i) => i.code);
  assert.ok(codes.some((c) => c.includes('jump')), `expected a jump issue in ${codes}`);
  assert.ok(codes.some((c) => c.includes('unreachable')), `expected unreachable in ${codes}`);
});

test('cross-chapter jump pairs are valid', () => {
  let p = sceneProject();
  const ch2 = { id: 'ch2', name: 'Two', color: '#fff' };
  const jin = V.createNode(engine, p, 'core.jumpIn', p.chapters[0].id, 900, 0);
  const jout = V.createNode(engine, p, 'core.jumpOut', 'ch2', 0, 0);
  const s = V.createNode(engine, p, 'core.scene', 'ch2', 300, 0);
  p = V.produce(p, (d) => {
    d.chapters.push(ch2);
    jin.data.number = 1; jout.data.number = 1;
    d.nodes[jin.id] = jin; d.nodes[jout.id] = jout; d.nodes[s.id] = s;
    const b = Object.values(d.nodes).find((n) => n.type === 'core.scene' && n.x === 600);
    V.connect(engine, d, { node: b.id, port: 'next' }, { node: jin.id, port: 'in' });
    V.connect(engine, d, { node: jout.id, port: 'out' }, { node: s.id, port: 'in' });
  });
  const errors = V.validateProject(engine, p).filter((i) => i.severity === 'error');
  assert.deepEqual(errors, []);
  assert.ok(V.reachableFrom(p, V.startNode(p).id).has(s.id));
});

test('unknown module data survives load and save', () => {
  const p = sceneProject();
  const raw = JSON.parse(V.serializeProject(p));
  raw.nodes.x1 = { id: 'x1', type: 'com.someone.missing/thing', chapterId: p.chapters[0].id, name: 'Mystery', x: 0, y: 0, data: { secret: 42 }, modules: [] };
  raw.extensions['com.someone.missing'] = { keep: true };
  raw.futureField = 'kept';
  const loaded = V.loadProject(JSON.stringify(raw)).project;
  const again = JSON.parse(V.serializeProject(loaded));
  assert.equal(again.nodes.x1.data.secret, 42);
  assert.equal(again.extensions['com.someone.missing'].keep, true);
  assert.equal(again.futureField, 'kept');
  const issues = V.validateProject(engine, loaded);
  assert.ok(issues.some((i) => i.target?.nodeId === 'x1' || JSON.stringify(i).includes('x1')), 'missing module type is reported');
});

test('newer project formats are refused instead of damaged', () => {
  const raw = JSON.parse(V.serializeProject(V.createProject('x')));
  raw.formatVersion = 999;
  assert.throws(() => V.loadProject(raw), /newer/);
});

test('expressions and variable operations', () => {
  const vars = new Map([['hp', 3], ['name', 'Mika']]);
  const scope = { get: (id) => vars.get(id) };
  const e = { k: 'op', op: 'and', a: { k: 'op', op: '>=', a: { k: 'var', id: 'hp' }, b: { k: 'lit', v: 2 } }, b: { k: 'op', op: '==', a: { k: 'var', id: 'name' }, b: { k: 'lit', v: 'Mika' } } };
  assert.equal(V.evaluate(e, scope), true);
  assert.equal(V.applyVarOp({ id: 'hp', name: 'hp', type: 'number', initial: 0, scope: 'game' }, 3, { varId: 'hp', op: 'add', value: 2 }), 5);
});

test('semver ranges used by module compatibility', () => {
  assert.ok(V.satisfies('0.1.0', '>=0.1.0 <1.0.0'));
  assert.ok(!V.satisfies('1.2.0', '>=0.1.0 <1.0.0'));
  assert.ok(V.satisfies('1.4.2', '^1.0.0'));
  assert.ok(!V.satisfies('2.0.0', '^1.0.0'));
  assert.equal(V.checkCompatibility({ id: 'a.b', version: '1.0.0', engine: '>=9.0.0', api: '^1.0.0' }).ok, false);
});
