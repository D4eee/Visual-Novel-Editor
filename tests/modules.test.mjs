import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as V from '../dist/test/vne.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'examples/extensions');

function source(dir) {
  return { manifest: JSON.parse(readFileSync(path.join(dir, 'module.json'), 'utf8')), baseUrl: pathToFileURL(dir + path.sep).href };
}

async function host(dirs) {
  const engine = V.createEngine();
  const errors = [];
  const h = new V.ModuleHost(engine, new V.I18n('en'), { mode: 'game', onError: (id, err, where) => errors.push({ id, where, err: String(err) }) });
  await h.loadAll(dirs.map(source));
  return { engine, h, errors };
}

test('every example extension loads, passes manifest checks and registers what it declares', async () => {
  const dirs = readdirSync(extDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(extDir, d.name));
  assert.ok(dirs.length >= 7);
  for (const d of dirs) assert.deepEqual(V.validateManifest(source(d).manifest), [], d);
  const { engine, h, errors } = await host(dirs);
  assert.deepEqual(errors, []);
  for (const r of h.records.values()) assert.equal(r.status, 'active', `${r.manifest.id}: ${r.error}`);
  const has = (reg, id) => assert.ok(engine[reg].get(id), `${reg} ${id}`);
  has('nodeTypes', 'com.example.dice-check/skillCheck');
  has('portTypes', 'com.example.dice-check/roll');
  has('layerTypes', 'com.example.speech-bubble/bubble');
  has('properties', 'com.example.wobble/wobble');
  has('interpolators', 'com.example.wobble/smoothstep');
  has('effectNodes', 'com.example.retro-fx/scanlines');
  has('transitions', 'com.example.retro-fx/pixels');
  has('blocks', 'com.example.extra-blocks/chance');
  has('components', 'com.example.timed-choices/timer');
  has('systems', 'com.example.relationships/affection');
  has('nodeTypes', 'com.example.relationships/branch');
  // Module functions are callable by their local name in expressions.
  assert.equal(typeof engine.functionTable(V.builtinFunctions).affection?.fn, 'function');
  assert.equal(typeof engine.functionTable(V.builtinFunctions).randomFloat?.fn, 'function');
  // Custom layer properties show up for the layer type.
  assert.ok(engine.layerProps('core.image').some((p) => p.key === 'wobble'));
});

test('a failing module is isolated and reported; others still load', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vne-mod-'));
  const bad = path.join(tmp, 'bad');
  mkdirSync(bad);
  writeFileSync(path.join(bad, 'module.json'), JSON.stringify({ id: 'com.test.bad', name: 'Bad', version: '1.0.0', engine: '>=0.1.0', api: '^1.0.0', runtime: 'runtime.js' }));
  writeFileSync(path.join(bad, 'runtime.js'), 'export function activate(api) { api.blocks.register({ id: "x", category: "looks", shape: "statement", label: "x", args: [], run() {} }); throw new Error("boom"); }');
  const old = path.join(tmp, 'old');
  mkdirSync(old);
  writeFileSync(path.join(old, 'module.json'), JSON.stringify({ id: 'com.test.old', name: 'Old', version: '1.0.0', engine: '>=5.0.0', api: '^1.0.0', runtime: 'runtime.js' }));
  writeFileSync(path.join(old, 'runtime.js'), 'export function activate() {}');
  const { engine, h } = await host([bad, old, path.join(extDir, 'dice-check')]);
  assert.equal(h.records.get('com.test.bad').status, 'failed');
  assert.match(String(h.records.get('com.test.bad').error), /boom/);
  assert.equal(engine.blocks.get('com.test.bad/x'), undefined, 'registrations of a failed module are rolled back');
  assert.notEqual(h.records.get('com.test.old').status, 'active');
  assert.equal(h.records.get('com.example.dice-check').status, 'active');
});

test('the Like Human example validates without errors with its modules', async () => {
  const game = path.join(root, 'examples/games/like-human');
  const project = V.loadProject(readFileSync(path.join(game, 'project.vne.json'), 'utf8')).project;
  const ids = project.modules.map((m) => m.id);
  const { engine, h } = await host(ids.map((id) => path.join(game, 'modules', id)));
  const status = new Map([...h.records.values()].map((r) => [r.manifest.id, { status: r.status === 'active' ? 'ok' : 'failed' }]));
  const issues = V.validateProject(engine, project, { moduleStatus: status });
  assert.deepEqual(issues.filter((i) => i.severity === 'error'), []);
  // Every asset referenced exists on disk.
  for (const a of project.assets) readFileSync(path.join(game, a.path));
  // Two chapters joined by a jump pair.
  const jumps = Object.values(project.nodes).filter((n) => n.type === 'core.jumpIn' || n.type === 'core.jumpOut');
  assert.equal(new Set(jumps.map((n) => n.chapterId)).size, 2);
});
