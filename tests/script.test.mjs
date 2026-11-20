import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../dist/test/vne.mjs';

/** A script host with a fake scene: enough to run blocks without a browser. */
function harness(sceneApi = null) {
  const engine = V.createEngine();
  const project = V.createProject('Scripts');
  project.variables.push({ id: 'var_score', name: 'score', type: 'number', default: 0, scope: 'game' });
  const vars = new V.VarStore(() => project);
  const errors = [];
  const traced = [];
  const host = {
    engine, project, vars, scene: sceneApi,
    runtime: { input: { x: 120, y: 80, down: true, keys: new Set(['Space']) } },
    sleep: async () => {}, nextFrame: async () => {},
    emit() {}, reportError: (src, err) => errors.push(`${src}: ${err?.message || err}`),
    trace: (id) => traced.push(id),
  };
  const ctx = new V.ScriptContext(host, new V.CancelToken(), 'stack', null);
  const blk = (type, args = {}, extra = {}) => ({ id: V.newId('blk'), type, args, ...extra });
  const ref = (type, args) => ({ k: 'block', block: blk(type, args) });
  const lit = (v) => ({ k: 'lit', v });
  return { engine, project, vars, errors, traced, ctx, blk, ref, lit };
}

test('reporter and condition blocks nest inside slots and are evaluated when the block runs', async () => {
  const { ctx, vars, errors, traced, blk, ref, lit } = harness();
  // score = (2 + 3) × 4
  const set = blk('core.setVar', { variable: 'var_score', value: ref('core.multiply', { a: ref('core.add', { a: lit(2), b: lit(3) }), b: lit(4) }) });
  await V.runBlocks(ctx, [set]);
  assert.equal(vars.get('var_score'), 20);
  // if <score > 10 and not <score = 3>> then score = mouse x
  const cond = ref('core.and', { a: ref('core.greater', { a: ref('core.varValue', { variable: 'var_score' }), b: lit(10) }), b: ref('core.not', { a: ref('core.equals', { a: ref('core.varValue', { variable: 'var_score' }), b: lit(3) }) }) });
  await V.runBlocks(ctx, [blk('core.if', { cond }, { body: [blk('core.setVar', { variable: 'var_score', value: ref('core.mouseX', {}) })] })]);
  assert.equal(vars.get('var_score'), 120);
  // strings
  assert.equal(V.reportBlock(ctx, blk('core.join', { a: lit('ab'), b: ref('core.lengthOf', { s: lit('hello') }) })), 'ab5');
  assert.equal(V.reportBlock(ctx, blk('core.letterOf', { i: lit(2), s: lit('héllo') })), 'é');
  assert.equal(V.reportBlock(ctx, blk('core.contains', { s: lit('Apple'), t: lit('PP') })), true);
  assert.equal(V.reportBlock(ctx, blk('core.equals', { a: lit('10'), b: lit(10) })), true);
  assert.equal(V.reportBlock(ctx, blk('core.mathOf', { fn: 'abs', a: lit(-4) })), 4);
  assert.equal(V.reportBlock(ctx, blk('core.divide', { a: lit(1), b: lit(0) })), 0);
  for (let i = 0; i < 50; i++) { const r = V.reportBlock(ctx, blk('core.random', { from: lit(1), to: lit(3) })); assert.ok([1, 2, 3].includes(r)); }
  // sensing from the runtime input
  assert.equal(V.reportBlock(ctx, blk('core.keyPressed', { key: 'Space' })), true);
  assert.equal(V.reportBlock(ctx, blk('core.mouseDown', {})), true);
  // nested blocks are traced (test runs light them up)
  assert.ok(traced.length > 5);
  assert.deepEqual(errors, []);
});

test('unknown reporters report an error and give 0 instead of stopping the script', async () => {
  const { ctx, vars, errors, blk, ref } = harness();
  await V.runBlocks(ctx, [blk('core.setVar', { variable: 'var_score', value: ref('com.missing/thing', {}) }), blk('core.changeVar', { variable: 'var_score', delta: 5 })]);
  assert.equal(vars.get('var_score'), 5);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is its module installed/);
});

test('element sensing blocks ask the scene (mouse inside, touching, property of)', () => {
  const scene = {
    contains: (id) => id === 'lyr_area', touching: (a, b) => a === 'lyr_a' && b === 'lyr_b', isVisible: (id) => id !== 'lyr_hidden',
    getProp: (id, p) => (p === 'x' ? 42 : null), timer: 3.14159,
  };
  const { ctx, blk } = harness(scene);
  assert.equal(V.reportBlock(ctx, blk('core.mouseInside', { layer: 'lyr_area' })), true);
  assert.equal(V.reportBlock(ctx, blk('core.mouseInside', { layer: 'lyr_other' })), false);
  assert.equal(V.reportBlock(ctx, blk('core.touching', { layer: 'lyr_a', other: 'lyr_b' })), true);
  assert.equal(V.reportBlock(ctx, blk('core.isVisible', { layer: 'lyr_hidden' })), false);
  assert.equal(V.reportBlock(ctx, blk('core.propOf', { prop: 'x', layer: 'lyr_a' })), 42);
  assert.equal(V.reportBlock(ctx, blk('core.timer', {})), 3.14);
});

test('detection areas: rectangle, ellipse and polygon hit tests', () => {
  const W = 200, H = 100;
  assert.equal(V.regionContains({ shape: 'rect' }, 10, 10, W, H), true);
  assert.equal(V.regionContains({ shape: 'ellipse' }, 5, 5, W, H), false, 'corner is outside the ellipse');
  assert.equal(V.regionContains({ shape: 'ellipse' }, 100, 50, W, H), true);
  const tri = { shape: 'polygon', points: [[0.5, 0], [1, 1], [0, 1]] };
  assert.equal(V.regionContains(tri, 100, 60, W, H), true);
  assert.equal(V.regionContains(tri, 10, 10, W, H), false);
  assert.equal(V.regionContains({ shape: 'polygon', points: [[0, 0]] }, 10, 10, W, H), true, 'fewer than 3 corners: whole box');
});

test('blocks offered under each element follow their layerTypes', () => {
  const { engine } = harness();
  const forType = (type) => engine.blocks.list().filter((d) => {
    const arg = d.args.find((a) => a.type === 'layer');
    if (!arg) return false;
    const visual = engine.layerTypes.get(type)?.visual !== false;
    return d.layerTypes ? d.layerTypes.includes('*') || d.layerTypes.includes(type) : visual;
  }).map((d) => d.id);
  const audio = forType('core.audio');
  assert.ok(audio.includes('core.playMedia') && audio.includes('core.startElement') && !audio.includes('core.show'));
  const area = forType('core.hotspot');
  assert.ok(area.includes('core.mouseInside') && area.includes('core.whenMouseInside') && !area.includes('core.playMedia'));
  assert.ok(forType('core.text').includes('core.setText'));
});
