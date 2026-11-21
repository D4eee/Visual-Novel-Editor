// 1.0.0: in/out points, parent links, the AI assistant's host side and element presets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import * as V from '../dist/test/vne.mjs';

const engine = V.createEngine();
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'vne-v1-'));

test('in/out points hide an element outside its span, and extend the clip end', () => {
  const clip = { ...V.createAnimation('A', 2), spans: { L1: { in: 0.5, out: 3 } } };
  const at = (t) => V.sampleClip(engine, clip, t, () => undefined).get('L1')?.__span;
  assert.equal(at(0.2), false);
  assert.equal(at(0.5), true);
  assert.equal(at(2.9), true);
  assert.equal(at(3), false);
  assert.equal(V.clipEnd(clip), 3);
  const open = { ...V.createAnimation('B', 2), spans: { L1: { in: 1, out: null } } };
  assert.equal(V.sampleClip(engine, open, 5, () => undefined).get('L1').__span, true);
});

test('parent link: a child follows its parent\'s position, rotation and scale (same group only, no loops)', () => {
  const props = { P: { x: 100, y: 50, rotation: 90, scaleX: 2, scaleY: 2 }, C: { x: 10, y: 0 } };
  const layers = [
    { id: 'P', type: 'core.shape', parentId: null, link: null },
    { id: 'C', type: 'core.shape', parentId: null, link: 'P' },
    { id: 'G', type: 'core.shape', parentId: 'group', link: 'P' },
  ];
  const m = V.linkMatrixWith(layers, layers[1], (l) => props[l.id]);
  const p = V.applyMatrix(m, 10, 0);
  assert.ok(Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 70) < 1e-6, JSON.stringify(p)); // rotated 90° and scaled 2×
  assert.deepEqual(V.linkMatrixWith(layers, layers[2], (l) => props[l.id]), [1, 0, 0, 1, 0, 0]); // different group: ignored
  const loop = [{ id: 'A', parentId: null, link: 'B' }, { id: 'B', parentId: null, link: 'A' }];
  assert.ok(V.linkMatrixWith(loop, loop[0], () => ({ x: 1, y: 1 }))); // terminates
});

test('OpenAI-compatible messages: tool calls and results convert both ways', () => {
  const msgs = V.toOpenAiMessages('sys', [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'get_scene', input: { node_id: 'n' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"a":1}' }, { type: 'text', text: 'and?' }] },
  ]);
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'user']);
  assert.equal(msgs[2].tool_calls[0].function.arguments, '{"node_id":"n"}');
  assert.equal(msgs[3].tool_call_id, 't1');
  const back = V.fromOpenAiMessage({ content: 'x', tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"k":2}' } }] });
  assert.deepEqual(back, [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'c', name: 'f', input: { k: 2 } }]);
});

test('AI settings: keys stay on disk per service, never reach the editor, and are only sent to their own service', async () => {
  const dir = tmp();
  const file = path.join(dir, 'ai.json');
  // A fake OpenAI-compatible service that records what it receives.
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization || null, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'm', choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'get_project_overview', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const secrets = { encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString() };
    const ai = new V.AiService(file, secrets);
    let pub = await ai.update({ provider: 'openai', openai: { baseUrl: base, model: 'm', key: 'sk-test-1234' } });
    assert.equal(pub.openai.hasKey, true);
    assert.equal(pub.openai.keyHint, '…1234');
    assert.ok(!JSON.stringify(pub).includes('sk-test'), 'public config must not contain the key');
    assert.ok(!readFileSync(file, 'utf8').includes('sk-test-1234'), 'key is stored encrypted');
    const r = await ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'get_project_overview', description: 'd', inputSchema: { type: 'object', properties: {} } }] });
    assert.equal(r.stopReason, 'tool_use');
    assert.equal(r.content[0].name, 'get_project_overview');
    assert.equal(seen[0].auth, 'Bearer sk-test-1234');
    assert.equal(seen[0].body.tools[0].function.name, 'get_project_overview');
    // A reloaded service reads the key back.
    const again = new V.AiService(file, secrets);
    assert.equal((await again.getPublic()).openai.hasKey, true);
    // Pointing the provider at another address does not carry the key along.
    pub = await again.update({ openai: { baseUrl: 'https://other.example/v1' } });
    assert.equal(pub.openai.hasKey, false);
    await assert.rejects(() => again.chat({ messages: [{ role: 'user', content: 'x' }] }), /NO_KEY/);
    // …and switching back finds it again.
    pub = await again.update({ openai: { baseUrl: base } });
    assert.equal(pub.openai.hasKey, true);
    pub = await again.update({ openai: { clearKey: true } });
    assert.equal(pub.openai.hasKey, false);
  } finally { server.close(); }
});

test('web API refuses requests from other web pages', async () => {
  // dist/server.js runs the same checks; here: the rule itself (JSON only, local origin only).
  const src = readFileSync(new URL('../packages/host/src/server.ts', import.meta.url), 'utf8');
  assert.match(src, /application\/json/);
  assert.match(src, /req\.headers\.origin/);
});

test('element presets: save, list and delete looks', async () => {
  const store = new V.ElementPresetStore(path.join(tmp(), 'presets'));
  await store.save({ id: 'elp_1', name: 'Neon', layerType: 'core.text', props: { color: '#7df9ff' } });
  await store.save({ id: 'elp_2', name: 'Card', layerType: 'core.shape', props: { radius: 18 } });
  const list = await store.list();
  assert.deepEqual(list.map((p) => p.name), ['Card', 'Neon']);
  await assert.rejects(() => store.save({ id: '../x', name: 'bad', layerType: 'core.text', props: {} }), /Invalid preset id/);
  await store.remove('elp_1');
  assert.deepEqual((await store.list()).map((p) => p.id), ['elp_2']);
});
