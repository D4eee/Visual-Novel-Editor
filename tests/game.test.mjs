import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../dist/test/vne.mjs';

const engine = V.createEngine();
const blk = (type, args = {}, extra = {}) => ({ id: V.newId('blk'), type, args, ...extra });
const lit = (v) => ({ k: 'lit', v });
const stack = (hat, body) => ({ id: V.newId('stk'), x: 0, y: 0, enabled: true, hat, body });

/** start → A → B → C, each a page. */
function threePages() {
  const p = V.createProject('Game');
  const ch = p.chapters[0].id;
  const start = V.createNode(engine, p, 'core.start', ch, 0, 0);
  const [a, b, c] = [1, 2, 3].map((i) => V.createNode(engine, p, 'core.scene', ch, 300 * i, 0));
  const out = V.produce(p, (d) => {
    for (const n of [start, a, b, c]) d.nodes[n.id] = n;
    V.connect(engine, d, { node: start.id, port: 'out' }, { node: a.id, port: 'in' });
    V.connect(engine, d, { node: a.id, port: 'next' }, { node: b.id, port: 'in' });
    V.connect(engine, d, { node: b.id, port: 'next' }, { node: c.id, port: 'in' });
  });
  return { p: out, a: a.id, b: b.id, c: c.id };
}

const addLayer = (p, nodeId, type, name, props = {}) => {
  const l = V.createLayer(engine, p, type, name, props);
  p.nodes[nodeId].data.layers.push(l);
  return l;
};

test('pages inherit running music, looping animations and running loops with their elements', () => {
  const { p, a, b, c } = threePages();
  const music = addLayer(p, a, 'core.audio', 'Theme', { autoplay: true, loop: true });
  const sfx = addLayer(p, a, 'core.audio', 'Click', { autoplay: false, loop: false, category: 'sfx' });
  const star = addLayer(p, a, 'core.image', 'Star');
  const cloud = addLayer(p, a, 'core.image', 'Cloud');
  p.nodes[a].data.animations.push({ id: 'anm_spin', name: 'Spin', loop: true, autoplay: true, duration: 2, tracks: [{ id: 't1', layerId: cloud.id, prop: 'rotation', keyframes: [] }], media: [], markers: [] });
  p.nodes[a].data.scripts.push(stack(blk('core.whenSceneStarts'), [blk('core.forever', {}, { body: [blk('core.turnBy', { layer: star.id, deg: lit(5) })] })]));
  const inB = V.inheritedInto(engine, p, b);
  assert.deepEqual(inB.elements.map((e) => e.layer.name).sort(), ['Cloud', 'Star', 'Theme']);
  assert.ok(!inB.elements.some((e) => e.layer.id === sfx.id));
  assert.equal(inB.scripts.length, 1);
  assert.ok(inB.elements.every((e) => e.fromNodeId === a && !e.paused));
  // Transitive: C inherits through B; B's own music replaces the inherited one.
  assert.equal(V.inheritedInto(engine, p, c).elements.length, 3);
  addLayer(p, b, 'core.audio', 'Battle', { autoplay: true, loop: true });
  const inC = V.inheritedInto(engine, p, c).elements.map((e) => e.layer.name).sort();
  assert.deepEqual(inC, ['Battle', 'Cloud', 'Star']);
  // Scripts on B may use the inherited elements without validation errors.
  p.nodes[b].data.scripts.push(stack(blk('core.whenSceneStarts'), [blk('core.hide', { layer: star.id })]));
  assert.ok(!V.validateProject(engine, p).some((i) => i.code === 'script.layer'));
});

test('"when the page changes, remove" drops an element; "pause" carries it paused; empty means this script', () => {
  const { p, a, b } = threePages();
  const star = addLayer(p, a, 'core.image', 'Star');
  const moon = addLayer(p, a, 'core.image', 'Moon');
  const music = addLayer(p, a, 'core.audio', 'Theme', { autoplay: true, loop: true });
  const s1 = stack(blk('core.whenSceneStarts'), [blk('core.onLeavePause'), blk('core.forever', {}, { body: [blk('core.turnBy', { layer: star.id })] })]);
  const s2 = stack(blk('core.everySeconds', { seconds: 1 }), [blk('core.changeXY', { layer: moon.id })]);
  p.nodes[a].data.scripts.push(s1, s2, stack(blk('core.whenSceneStarts'), [blk('core.onLeaveRemove', { layer: music.id })]));
  const r = V.inheritedInto(engine, p, b);
  const byName = Object.fromEntries(r.elements.map((e) => [e.layer.name, e]));
  assert.equal(byName.Star.paused, true);
  assert.equal(byName.Moon.paused, false);
  assert.equal(byName.Theme, undefined);
  assert.deepEqual(r.scripts.map((s) => [s.stack.id, s.paused]).sort(), [[s1.id, true], [s2.id, false]].sort());
  // Remove with an empty element: the script and its elements stay behind.
  p.nodes[a].data.scripts[1].body.unshift(blk('core.onLeaveRemove'));
  const r2 = V.inheritedInto(engine, p, b);
  assert.ok(!r2.elements.some((e) => e.layer.id === moon.id));
  assert.ok(!r2.scripts.some((s) => s.stack.id === s2.id));
});

test('inheritance passes through logic nodes and groups take their contents along', () => {
  const p0 = V.createProject('Flow');
  const ch = p0.chapters[0].id;
  const start = V.createNode(engine, p0, 'core.start', ch, 0, 0);
  const a = V.createNode(engine, p0, 'core.scene', ch, 300, 0);
  const cond = V.createNode(engine, p0, 'core.condition', ch, 600, 0);
  const b = V.createNode(engine, p0, 'core.scene', ch, 900, 0);
  const p = V.produce(p0, (d) => {
    for (const n of [start, a, cond, b]) d.nodes[n.id] = n;
    V.connect(engine, d, { node: start.id, port: 'out' }, { node: a.id, port: 'in' });
    V.connect(engine, d, { node: a.id, port: 'next' }, { node: cond.id, port: 'in' });
    V.connect(engine, d, { node: cond.id, port: 'true' }, { node: b.id, port: 'in' });
  });
  const group = addLayer(p, a.id, 'core.group', 'Fireflies');
  const child = addLayer(p, a.id, 'core.image', 'Fly');
  child.parentId = group.id;
  p.nodes[a.id].data.scripts.push(stack(blk('core.everySeconds', { seconds: 0.5 }), [blk('core.turnBy', { layer: group.id })]));
  assert.deepEqual(V.inheritedInto(engine, p, b.id).elements.map((e) => e.layer.name).sort(), ['Fireflies', 'Fly']);
});

/* --------------------------------------------------------------------------- */
/* Runtime: a fake game runtime that is enough for pages, scripts and items      */
/* --------------------------------------------------------------------------- */

function fakeRuntime(project) {
  const errors = [];
  const rt = {
    engine, project, errors, scene: null,
    vars: new V.VarStore(() => project),
    assets: { image: () => null, imageFailed: () => false, asset: () => null, url: () => null, preloadImages: async () => {} },
    audio: { track: () => ({ setBase() {}, untrack() {} }), musicAssetId: null },
    pool: null, shaders: null,
    reportError: (src, err) => errors.push(`${src}: ${err?.message || err}`),
    debug: { emit() {} }, debugEvent() {},
    // Waits never finish on their own: loops stay "running" until the page stops them.
    sleep: (_s, tok) => new Promise((res) => tok?.onCancel(res)),
    nextFrame: (tok) => new Promise((res) => tok?.onCancel(res)),
    input: { x: 0, y: 0, down: false, keys: new Set() },
    narrative: { hideChoices() {}, setBoxVisible() {} },
  };
  rt.functions = engine.functionTable(V.builtinFunctions);
  rt.items = new V.Items(rt);
  rt.globals = new V.GlobalPage(rt);
  rt.functions.has = { id: 'has', label: 'has', args: 1, fn: (x) => rt.items.has(x) };
  rt.api = { events: new V.Emitter(), items: rt.items, input: rt.input, project };
  return rt;
}

function startPage(rt, nodeId, carry = null) {
  const page = new V.ScenePlayer(rt, rt.project.nodes[nodeId], 0, carry);
  rt.scene = page;
  page.scripts.start();
  return page;
}

test('at run time, running loops and their elements carry over; paused ones wait for "resume"', async () => {
  const { p, a, b } = threePages();
  const star = addLayer(p, a, 'core.image', 'Star');
  const moon = addLayer(p, a, 'core.image', 'Moon');
  const still = addLayer(p, a, 'core.image', 'Still');
  const spin = stack(blk('core.whenLayerClicked', { layer: still.id }), [blk('core.forever', {}, { body: [blk('core.turnBy', { layer: star.id, deg: lit(5) }), blk('core.wait', { seconds: 0.1 })] })]);
  const orbit = stack(blk('core.whenLayerClicked', { layer: still.id }), [blk('core.onLeavePause'), blk('core.forever', {}, { body: [blk('core.changeXY', { layer: moon.id, dx: lit(1) }), blk('core.wait', { seconds: 0.1 })] })]);
  p.nodes[a].data.scripts.push(spin, orbit);
  const rt = fakeRuntime(p);
  const pa = startPage(rt, a);
  pa.dispatch({ type: 'layer.click', layerId: still.id });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pa.getProp(star.id, 'rotation'), 5);
  pa.freeze();
  const carry = pa.handOff(p.nodes[b]);
  // "Still" is the trigger of both loops, so it comes along (running wins over paused).
  assert.deepEqual(carry.layers.map((c) => [c.layer.name, c.paused]).sort(), [['Moon', true], ['Star', false], ['Still', false]]);
  pa.dispose();
  const pb = startPage(rt, b, carry);
  assert.ok(pb.layers.some((l) => l.id === star.id) && pb.layerOrigin(star.id) === 'carried');
  // The running loop starts again on the new page; the paused one waits.
  pb.play = undefined;
  for (const c of carry.scripts) if (!c.paused && c.running) pb.scripts.spawn(c.stack, null);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pb.getProp(star.id, 'rotation'), 10);
  assert.equal(pb.getProp(moon.id, 'x'), pa.layerState.get(moon.id).x);
  assert.ok(pb.pausedScripts.has(orbit.id));
  const before = pb.getProp(moon.id, 'x');
  pb.resumeElement(moon.id);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pb.getProp(moon.id, 'x'), before + 1);
  pb.freeze();
  assert.deepEqual(rt.errors, []);
});

test('global elements are on every page and keep their state; parameters work as values', async () => {
  const { p, a, b } = threePages();
  const hud = addLayer(p, V.GLOBAL_NODE_ID, 'core.text', 'HUD', { text: 'HP' });
  hud.params = [{ id: 'hp', name: 'hp', type: 'number', initial: 10 }, { id: 'title', name: 'title', type: 'string', initial: 'Hero' }];
  const rt = fakeRuntime(p);
  const pa = startPage(rt, a);
  assert.ok(pa.layers.some((l) => l.id === hud.id));
  assert.equal(pa.layerOrigin(hud.id), 'global');
  const ctx = new V.ScriptContext({ engine, project: p, vars: rt.vars, scene: pa, runtime: rt.api, sleep: rt.sleep, nextFrame: rt.nextFrame, emit() {}, reportError: rt.reportError, functions: rt.functions }, new V.CancelToken(), 'test', null);
  await V.runBlocks(ctx, [blk('core.changeParam', { layer: hud.id, param: 'hp', delta: lit(-3) }), blk('core.setParam', { layer: hud.id, param: 'title', value: lit('Ace') }), blk('core.hide', { layer: hud.id })]);
  assert.equal(V.reportBlock(ctx, blk('core.paramOf', { layer: hud.id, param: 'hp' })), 7);
  pa.freeze();
  const pb = startPage(rt, b, pa.handOff(p.nodes[b]));
  pa.dispose();
  assert.equal(pb.getProp(hud.id, 'param.hp'), 7);
  assert.equal(pb.getProp(hud.id, 'param.title'), 'Ace');
  assert.equal(pb.isVisible(hud.id), false);
  assert.deepEqual(rt.errors, []);
});

test('collectibles: pick up, inventory list, has(), item-locked choices and using an item on an element', async () => {
  const { p, a, b } = threePages();
  V.createItem(p, 'Key');
  V.createItem(p, 'Coin');
  const inv = p.variables.find((v) => v.id === p.inventoryVarId);
  assert.equal(inv.type, 'list');
  const keyEl = addLayer(p, a, 'core.image', 'Key');
  const door = addLayer(p, b, 'core.image', 'Door');
  const choice = V.createLayer(engine, p, V.CHOICE_LAYER, 'Open the door', { text: 'Open the door' });
  p.nodes[b].data.layers.push(choice);
  Object.assign(choice.props, { requiresItem: 'Key', consumeItem: true, unavailable: 'disable' });
  const used = [];
  p.nodes[b].data.scripts.push(stack(blk('core.whenItemUsed', { item: p.items[0].id, layer: door.id }), [blk('core.setVar', { variable: inv.id, value: lit([]) })]));
  const rt = fakeRuntime(p);
  const pa = startPage(rt, a);
  rt.api.events.on('item.collected', (e) => used.push(e.item));
  const ctx = new V.ScriptContext({ engine, project: p, vars: rt.vars, scene: pa, runtime: rt.api, sleep: rt.sleep, nextFrame: rt.nextFrame, emit() {}, reportError: rt.reportError, functions: rt.functions }, new V.CancelToken(), 'test', null);
  await V.runBlocks(ctx, [blk('core.pickUp', { layer: keyEl.id }), blk('core.collectItem', { amount: lit(3), item: p.items[1].id })]);
  assert.equal(pa.isVisible(keyEl.id), false);
  assert.deepEqual(rt.vars.get(inv.id), ['Key', 'Coin', 'Coin', 'Coin']);
  const hasKey = { k: 'fn', fn: 'has', args: [lit('key')] };
  const coins = { k: 'op', op: '==', a: { k: 'fn', fn: 'count', args: [{ k: 'var', id: inv.id }, lit('Coin')] }, b: lit(3) };
  assert.equal(V.evaluate({ k: 'op', op: 'and', a: hasKey, b: coins }, rt.vars, rt.functions), true);
  assert.equal(V.reportBlock(ctx, blk('core.itemCount', { item: 'coin' })), 3);
  assert.deepEqual(V.inventorySlots(p, rt.vars.get(inv.id)).map((s) => [s.name, s.count]), [['Key', 1], ['Coin', 3]]);
  // Coming back to the page: the picked-up element stays gone.
  assert.equal(new V.ScenePlayer(rt, p.nodes[a]).visibleState.get(keyEl.id), false);
  pa.freeze();
  pa.dispose();
  const pb = startPage(rt, b);
  assert.deepEqual(pb.availableChoices().map((c) => [c.choice.text, c.disabled]), [['Open the door', false]]);
  rt.items.remove('Key');
  assert.deepEqual(pb.availableChoices().map((c) => c.disabled), [true]);
  rt.items.add('Key');
  rt.items.select('Key');
  assert.equal(pb.scripts.listens('item.used', (x) => x.layer === door.id), true);
  pb.dispatch({ type: 'item.used', item: 'Key', itemId: p.items[0].id, layerId: door.id });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(rt.vars.get(inv.id), []);
  assert.deepEqual(used, ['Key', 'Coin', 'Key']);
  assert.deepEqual(rt.errors, []);
});

test('list blocks store, find and change values', async () => {
  const p = V.createProject('Lists');
  p.variables.push({ id: 'var_l', name: 'bag', type: 'list', initial: [], scope: 'game' });
  const rt = fakeRuntime(p);
  const ctx = new V.ScriptContext({ engine, project: p, vars: rt.vars, scene: null, runtime: rt.api, sleep: rt.sleep, nextFrame: rt.nextFrame, emit() {}, reportError: rt.reportError, functions: rt.functions }, new V.CancelToken(), 'test', null);
  const L = { variable: 'var_l' };
  await V.runBlocks(ctx, [
    blk('core.listAdd', { ...L, value: lit('apple') }), blk('core.listAdd', { ...L, value: lit(3) }), blk('core.listInsert', { ...L, value: lit('pear'), index: lit(1) }),
    blk('core.listReplace', { ...L, index: lit('last'), value: lit(4) }), blk('core.listAdd', { ...L, value: lit('fig') }), blk('core.listRemove', { ...L, value: lit('APPLE') }),
  ]);
  assert.deepEqual(rt.vars.get('var_l'), ['pear', 4, 'fig']);
  assert.equal(V.reportBlock(ctx, blk('core.listItem', { ...L, index: lit(2) })), 4);
  assert.equal(V.reportBlock(ctx, blk('core.listIndexOf', { ...L, value: lit('fig') })), 3);
  assert.equal(V.reportBlock(ctx, blk('core.listLength', L)), 3);
  assert.equal(V.reportBlock(ctx, blk('core.listContains', { ...L, value: lit('Pear') })), true);
  await V.runBlocks(ctx, [blk('core.listDelete', { ...L, index: lit(1) })]);
  assert.equal(V.evaluate({ k: 'op', op: '+', a: { k: 'fn', fn: 'item', args: [{ k: 'var', id: 'var_l' }, lit(1)] }, b: { k: 'fn', fn: 'length', args: [{ k: 'var', id: 'var_l' }] } }, rt.vars, rt.functions), 6);
  // The initial value is not changed by the blocks.
  assert.deepEqual(p.variables[0].initial, []);
  await V.runBlocks(ctx, [blk('core.listClear', L)]);
  assert.deepEqual(rt.vars.get('var_l'), []);
  assert.deepEqual(rt.errors, []);
});

test('sprites step through frames, loop or stop at the end, and reverse', () => {
  const s = { frames: [{ assetId: 'a' }, { assetId: 'b' }, { assetId: 'c' }], frame: 1, fps: 10, playing: true, loop: true };
  V.stepSprite(s, 0.25);
  assert.equal(s.frame, 3);
  V.stepSprite(s, 0.1);
  assert.equal(s.frame, 1);
  s.loop = false; s.reverse = true; s.frame = 2; s._acc = 0;
  assert.equal(V.stepSprite(s, 0.1), false);
  assert.equal(s.frame, 1);
  assert.equal(V.stepSprite(s, 0.1), true);
  assert.equal(s.playing, false);
  assert.equal(s.frame, 1);
});

test('labels show values at a position and follow them', () => {
  const { p, a } = threePages();
  p.variables.push({ id: 'var_hp', name: 'hp', type: 'number', initial: 5, scope: 'game' });
  const rt = fakeRuntime(p);
  const pa = startPage(rt, a);
  pa.showLabel('HP', () => `HP ${rt.vars.get('var_hp')}`, 20, 30);
  const label = pa.layers.find((l) => l.name === 'HP');
  assert.ok(label);
  rt.vars.set('var_hp', 4);
  pa.update(0.016);
  assert.equal(pa.layerState.get(label.id).text, 'HP 4');
  pa.hideLabel('HP');
  assert.ok(!pa.layers.some((l) => l.name === 'HP'));
});

test('free dialogue: sizes to its text, types at its speed and is driven by the say block', async () => {
  const { p, a } = threePages();
  const fd = addLayer(p, a, 'core.freeDialogue', 'Bubble', { x: 300, y: 200, text: 'Hi', typeSpeed: 20, shape: 'bubble' });
  const def = engine.layerTypes.get('core.freeDialogue');
  assert.ok(def && def.props.some((d) => d.key === 'fill' && d.animatable) && def.props.some((d) => d.key === 'tailSide'));
  const rt = fakeRuntime(p);
  const pa = startPage(rt, a);
  const st = pa.layerState.get(fd.id);
  // Text changes type themselves at typeSpeed characters per second.
  def.step(st, 0, { layer: fd, emit() {}, runtime: rt.api });
  st.text = 'Hello there';
  const events = [];
  def.step(st, 0.1, { layer: fd, emit: (e) => events.push(e.type), runtime: rt.api });
  assert.ok(st.reveal > 0 && st.reveal < 1);
  for (let i = 0; i < 10; i++) def.step(st, 0.1, { layer: fd, emit: (e) => events.push(e.type), runtime: rt.api });
  assert.equal(st.reveal, 1);
  assert.deepEqual(events, ['dialogue.typed']);
  // The say block sets speaker and text and (with a typing speed) waits until typed.
  const ctx = new V.ScriptContext({ engine, project: p, vars: rt.vars, scene: pa, runtime: rt.api, sleep: rt.sleep, nextFrame: (tok) => new Promise((r) => setTimeout(r, 1)), emit() {}, reportError: rt.reportError, functions: rt.functions }, new V.CancelToken(), 'test', null);
  pa.setProp(fd.id, 'typeSpeed', 0);
  await V.runBlocks(ctx, [blk('core.freeSay', { layer: fd.id, text: lit('Welcome'), speaker: 'Seven', wait: true })]);
  assert.equal(pa.getProp(fd.id, 'text'), 'Welcome');
  assert.equal(pa.getProp(fd.id, 'speaker'), 'Seven');
  assert.equal(pa.getProp(fd.id, 'reveal'), 1);
  // Set text also works on it.
  await V.runBlocks(ctx, [blk('core.setText', { layer: fd.id, text: lit('Bye') })]);
  assert.equal(pa.getProp(fd.id, 'text'), 'Bye');
  assert.deepEqual(rt.errors, []);
});

test('fonts: an imported font asset resolves to its registered family, other values stay CSS', () => {
  const p = V.createProject('Fonts');
  p.assets.push({ id: 'ast_f', name: 'Hand Written.ttf', kind: 'font', path: 'assets/fonts/Hand Written.ttf', size: 1, hash: 'x', tags: [], meta: {}, imported: '' });
  assert.equal(V.fontFamilyName(p.assets[0]), 'vne-Hand_Written');
  assert.ok(V.resolveFontFamily(p, 'ast_f').startsWith('"vne-Hand_Written"'));
  assert.equal(V.resolveFontFamily(p, 'Georgia, serif'), 'Georgia, serif');
  assert.equal(V.resolveFontFamily(p, ''), 'system-ui, sans-serif');
  // Used fonts count as used assets (exported with the game).
  p.settings.textbox.fontFamily = 'ast_f';
  assert.ok(V.usedAssetIds(p).has('ast_f'));
});
