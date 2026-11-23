import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../dist/test/vne.mjs';

const engine = V.createEngine();

test('script parser: scenes, speakers, portraits, choices and continuation', () => {
  const p = V.parseScript(`# Act 1
## Morning
[bg: #223344]
[voice: v1]
Mia: Five more minutes…
Mom (angry): You'll be late!
The rain stopped.
> Note: narration with a colon
* Get up -> Kitchen
* Stay -> END
## Kitchen
小美（开心）：早上好！
-> 结束
// comment
## Late
旁白：时间到了。`);
  assert.equal(p.chapters.length, 1);
  assert.equal(p.chapters[0].name, 'Act 1');
  const [a, b, c] = p.chapters[0].scenes;
  assert.equal(a.name, 'Morning');
  assert.equal(a.background, '#223344');
  assert.deepEqual(a.lines.map((l) => [l.speaker, l.portrait, l.text, l.voice]), [
    ['Mia', null, 'Five more minutes…', 'v1'],
    ['Mom', 'angry', "You'll be late!", null],
    [null, null, 'The rain stopped.', null],
    [null, null, 'Note: narration with a colon', null],
  ]);
  assert.deepEqual(a.choices.map((x) => [x.text, x.target]), [['Get up', 'Kitchen'], ['Stay', 'END']]);
  assert.deepEqual([b.lines[0].speaker, b.lines[0].portrait, b.lines[0].text], ['小美', '开心', '早上好！']);
  assert.equal(b.next, 'END');
  assert.equal(c.next, undefined);
  assert.equal(c.lines[0].speaker, null, 'narrator name means narration');
  assert.deepEqual(p.speakers, ['Mia', 'Mom', '小美']);
  assert.deepEqual(V.scriptStats(p), { chapters: 1, scenes: 3, lines: 6, choices: 2, speakers: 3 });
});

test('script parser: lines before a scene heading make an unnamed scene; choices win over ->', () => {
  const p = V.parseScript('Hello.\n* A -> X\n-> Y');
  const s = p.chapters[0].scenes[0];
  assert.equal(s.name, null);
  assert.equal(s.next, null);
  assert.ok(p.warnings.some((w) => w.code === 'choicesAndNext'));
});

function l10nProject() {
  const p = V.createProject('L10n');
  const ch = p.chapters[0].id;
  const n = V.createNode(engine, p, 'core.scene', ch, 0, 0, 'S');
  const dl = V.createLayer(engine, p, V.DIALOGUE_LAYER, 'Dialogue');
  dl.props.lines = [V.createDialogueLine('Hello', null), V.createDialogueLine('Bye', null)];
  n.data.layers.push(dl);
  return V.produce(p, (d) => {
    d.nodes[n.id] = n;
    d.characters.push({ id: 'chr_a', name: 'Alice', color: '#fff', portraits: [] });
    d.localization = { source: 'en', languages: ['zh-CN'], strings: { 'zh-CN': {} } };
  });
}

test('localization: collect, translate, outdated, localize and CSV round trip', () => {
  let p = l10nProject();
  const texts = V.collectTexts(engine, p);
  const lines = texts.filter((t) => t.kind === 'line');
  assert.equal(lines.length, 2);
  assert.ok(texts.some((t) => t.key === 'char:chr_a' && t.text === 'Alice'));
  p = V.produce(p, (d) => {
    d.localization.strings['zh-CN'][lines[0].key] = { t: '你好', s: 'Hello' };
    d.localization.strings['zh-CN']['char:chr_a'] = { t: '爱丽丝', s: 'Alice' };
  });
  const prog = V.translationProgress(engine, p, 'zh-CN');
  assert.equal(prog.done, 2);
  const zh = V.localizeProject(engine, p, 'zh-CN');
  const node = Object.values(zh.nodes).find((n) => n.type === 'core.scene');
  assert.deepEqual(V.sceneLines(node.data).map((l) => l.text), ['你好', 'Bye']);
  assert.equal(zh.characters[0].name, '爱丽丝');
  assert.equal(V.sceneLines(Object.values(p.nodes).find((n) => n.type === 'core.scene').data)[0].text, 'Hello', 'source untouched');
  const csv = V.translationsToCsv(V.collectTexts(engine, p), p, 'zh-CN');
  const back = V.csvTranslations(csv, 'zh-CN');
  assert.equal(back[lines[0].key], '你好');
  assert.deepEqual(V.projectLanguages(p), ['en', 'zh-CN']);
  assert.equal(V.pickLanguage(p, null, ['zh-CN', 'en']), 'zh-CN');
  assert.equal(V.pickLanguage(p, 'en', ['zh-CN']), 'en');
});

test('image service: request shapes for OpenAI format, Stability and Replicate; keys per service', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const os = await import('node:os');
  const dir = mkdtempSync(os.tmpdir() + '/vne-img-');
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const json = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/images/generations')) return json({ data: [{ b64_json: 'AAAA' }] });
    if (String(url).includes('stable-image')) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
    if (String(url).includes('/predictions') && init.method === 'POST') return json({ id: 'p1', status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } });
    if (String(url).endsWith('/predictions/p1')) return json({ id: 'p1', status: 'succeeded', output: ['https://cdn.example/x.png'] });
    if (String(url).startsWith('https://cdn.example/')) return new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'image/webp' } });
    return new Response('nope', { status: 404 });
  };
  const svc = new V.ImageService(dir + '/images.json', { encrypt: (s) => Buffer.from(s).toString('hex'), decrypt: (s) => Buffer.from(s, 'hex').toString() }, fakeFetch);
  await assert.rejects(svc.generate({ prompt: 'x' }), /NO_KEY/);
  await svc.update({ openai: { key: 'sk-1' }, stability: { key: 'sk-st' }, replicate: { key: 'r8_x' } });
  assert.ok(readFileSync(dir + '/images.json', 'utf8').includes('enc:'), 'keys are encrypted');
  assert.ok(!readFileSync(dir + '/images.json', 'utf8').includes('sk-1'));

  let r = await svc.generate({ prompt: 'rooftop', width: 1280, height: 720, count: 2 });
  assert.equal(r.images[0].data, 'AAAA');
  let body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gpt-image-1');
  assert.equal(body.size, '1536x1024');
  assert.equal(body.n, 2);
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-1');

  r = await svc.generate({ prompt: 'girl', width: 832, height: 1216, provider: 'stability', negative: 'text' });
  const st = calls[calls.length - 1];
  assert.match(st.url, /\/v2beta\/stable-image\/generate\/core$/);
  assert.equal(st.init.headers.accept, 'image/*');
  assert.equal(st.init.body.get('aspect_ratio'), '2:3');
  assert.equal(st.init.body.get('negative_prompt'), 'text');
  assert.equal(r.images[0].data, Buffer.from([1, 2, 3]).toString('base64'));

  r = await svc.generate({ prompt: 'city', width: 1920, height: 1080, provider: 'replicate' });
  const rp = calls.find((c) => c.url.includes('/models/black-forest-labs/flux-schnell/predictions'));
  assert.ok(rp);
  assert.equal(rp.init.headers.prefer, 'wait');
  assert.equal(JSON.parse(rp.init.body).input.aspect_ratio, '16:9');
  assert.equal(r.images[0].mediaType, 'image/webp');

  // A key is only sent to the service address it was saved for.
  await svc.update({ openai: { baseUrl: 'https://proxy.example/v1' } });
  await assert.rejects(svc.generate({ prompt: 'x' }), /NO_KEY/);
  assert.equal(V.aspectRatio(1280, 720), '16:9');
  assert.equal(V.openaiSize('dall-e-3', 720, 1280), '1024x1792');
});

test('OpenAI conversion: pictures from tools and users become image_url parts', () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } };
  const out = V.toOpenAiMessages('sys', [
    { role: 'user', content: [{ type: 'text', text: 'look' }, img] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'view_scene', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"ok":1}' }, img] }] },
  ]);
  assert.deepEqual(out[1].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
  assert.equal(out[3].role, 'tool');
  assert.equal(out[3].content, '{"ok":1}');
  assert.equal(out[4].role, 'user');
  assert.equal(out[4].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
});

test('track expressions: parse, follow with delay, wiggle, loop and errors', () => {
  assert.ok(V.compileExpr('follow("A", 0.5) + 2 * (3 - 1) ^ 2').ast);
  assert.match(V.compileExpr('alert(1)').error, /Unknown function/);
  assert.match(V.compileExpr('window').error, /Unknown name/);
  assert.match(V.compileExpr('1 +').error, /end/);
  const env = { time: 2, value: 10, prop: 'x', seed: 1, keyEnd: 0, valueAt: () => 0, follow: () => 0 };
  assert.equal(V.evalExpr(V.compileExpr('2 ^ 3 ^ 2').ast, env), 512, '^ groups to the right');
  assert.equal(V.evalExpr(V.compileExpr('value > 5 ? 1 : 0').ast, env), 1);
  assert.equal(V.evalExpr(V.compileExpr('-value + 1 * 2').ast, env), -8);

  const p = V.createProject('Expr');
  const n = V.createNode(engine, p, 'core.scene', p.chapters[0].id, 0, 0);
  const a = V.createLayer(engine, p, 'core.shape', 'A', { x: 0 });
  const b = V.createLayer(engine, p, 'core.shape', 'B', { x: 500 });
  const clip = {
    ...V.createAnimation('c', 2),
    tracks: [
      { id: 't1', layerId: a.id, prop: 'x', keyframes: [{ id: 'k1', t: 0, v: 0, ease: 'linear' }, { id: 'k2', t: 1, v: 100, ease: 'linear' }] },
      { id: 't2', layerId: b.id, prop: 'x', keyframes: [], expr: 'follow("a", 0.5) + 10' },
      { id: 't3', layerId: b.id, prop: 'y', keyframes: [{ id: 'k3', t: 0, v: 0, ease: 'linear' }, { id: 'k4', t: 1, v: 50, ease: 'linear' }], expr: 'loop()' },
      { id: 't4', layerId: a.id, prop: 'rotation', keyframes: [], expr: 'value + wiggle(2, 15)' },
    ],
  };
  const layers = [a, b];
  const propDef = (id, key) => engine.layerProps(layers.find((l) => l.id === id).type).find((d) => d.key === key);
  const lookup = (k) => { const l = layers.find((x) => x.id === k || x.name.toLowerCase() === k.toLowerCase()); return l && { id: l.id, props: l.props }; };
  const at = (t) => V.sampleClip(engine, clip, t, propDef, new Map(), lookup);
  assert.equal(at(1).get(b.id).x, 60, 'B follows A half a second later (+10)');
  assert.equal(at(0.25).get(b.id).x, 10);
  assert.equal(Math.round(at(1.5).get(b.id).y), 25, 'loop() repeats the keys');
  const w1 = at(0.7).get(a.id).rotation, w2 = at(0.7).get(a.id).rotation;
  assert.equal(w1, w2, 'wiggle repeats exactly');
  assert.ok(Math.abs(w1) <= 15);
  // A broken expression keeps the keyed value.
  const bad = { ...clip, tracks: [{ ...clip.tracks[0], expr: 'nope(' }] };
  assert.equal(V.sampleClip(engine, bad, 1, propDef, new Map(), lookup).get(a.id).x, 100);
  void n;
});

test('compositions: own animation time with start, speed, loop and back-and-forth', () => {
  const comp = { id: 'c', name: 'c', width: 10, height: 10, layers: [], animation: { ...V.createAnimation('a', 2), tracks: [] } };
  assert.equal(V.compositionTime(comp, 5, { startAt: 1 }), 2, 'once holds the end');
  assert.equal(V.compositionTime(comp, 0.5, { startAt: 1 }), 0, 'before the start');
  assert.equal(V.compositionTime(comp, 3.5, { startAt: 1, playback: 'loop' }), 0.5);
  assert.equal(V.compositionTime(comp, 4, { startAt: 1, playback: 'pingpong' }), 1);
  assert.equal(V.compositionTime(comp, 2, { speed: 0.5 }), 1);
});

test('1.1.1: scene script view round trip', () => {
  let p = V.createProject('S');
  const ch = p.chapters[0].id;
  const a = V.createNode(engine, p, 'core.scene', ch, 0, 0, 'A');
  const b = V.createNode(engine, p, 'core.scene', ch, 300, 0, 'B');
  const dl = V.createLayer(engine, p, V.DIALOGUE_LAYER, 'Dialogue');
  dl.props.lines = [V.createDialogueLine('Hello\nthere', 'chr_m'), V.createDialogueLine('Time: late', null), V.createDialogueLine('Rain.', null)];
  a.data.layers.push(dl);
  const c1 = V.createLayer(engine, p, V.CHOICE_LAYER, 'Go', { y: 100, text: 'Go' });
  a.data.layers.push(c1);
  p = V.produce(p, (d) => {
    d.nodes[a.id] = a; d.nodes[b.id] = b;
    d.characters.push({ id: 'chr_m', name: 'Mia', color: '#fff', portraits: [{ id: 'pt1', name: 'smile', assetId: null }] });
    d.edges.push({ id: 'e1', from: { node: a.id, port: `c:${c1.id}` }, to: { node: b.id, port: 'in' } });
  });
  const text = V.sceneToScript(p, a.id);
  assert.equal(text, 'Mia: Hello\\nthere\n> Time: late\nRain.\n\n* Go -> B');
  const back = V.parseScript(text).chapters[0].scenes[0];
  assert.deepEqual(back.lines.map((l) => [l.speaker, l.text]), [['Mia', 'Hello\\nthere'], [null, 'Time: late'], [null, 'Rain.']]);
  assert.deepEqual(back.choices.map((c) => [c.text, c.target]), [['Go', 'B']]);
  // A scene without choices writes where it continues.
  const p2 = V.produce(p, (d) => { d.nodes[a.id].data.layers = d.nodes[a.id].data.layers.filter((l) => l.type !== V.CHOICE_LAYER); d.edges = [{ id: 'e2', from: { node: a.id, port: 'next' }, to: { node: b.id, port: 'in' } }]; });
  assert.match(V.sceneToScript(p2, a.id), /\n-> B$/);
});

test('1.1.1: history steps and jumping several steps', () => {
  const h = new V.History({ n: 0 });
  for (let i = 1; i <= 4; i++) h.update(`step ${i}`, (d) => { d.n = i; });
  h.go(-3);
  assert.equal(h.state.n, 1);
  const st = h.steps();
  assert.deepEqual(st.past.map((e) => e.label), ['step 1']);
  assert.deepEqual(st.future.map((e) => e.label), ['step 2', 'step 3', 'step 4']);
  h.go(2);
  assert.equal(h.state.n, 3);
});

test('1.1.1: text box element is registered with wrapping props', () => {
  const def = engine.layerTypes.get('core.textbox');
  assert.ok(def);
  for (const k of ['text', 'width', 'height', 'padding', 'overflow', 'verticalAlign', 'fontSize', 'fill']) assert.ok(def.props.some((p) => p.key === k), k);
  assert.ok(V.isTranslatableProp ? V.isTranslatableProp(def.props.find((p) => p.key === 'text')) : true);
});
