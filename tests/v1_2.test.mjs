import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as V from '../dist/test/vne.mjs';

const engine = V.createEngine();
let n = 0;
const id = (p) => `${p}_${++n}`;

const ATLAS = `
hero.png
size: 256,256
format: RGBA8888
filter: Linear,Linear
repeat: none
head
  rotate: false
  xy: 2, 2
  size: 60, 80
  orig: 64, 84
  offset: 2, 1
  index: -1
arm
  rotate: true
  xy: 70, 2
  size: 20, 50
  orig: 20, 50
  offset: 0, 0
  index: -1
`;

const SPINE = {
  skeleton: { spine: '4.1.0', x: -100, y: -10, width: 200, height: 300 },
  bones: [
    { name: 'root' },
    { name: 'body', parent: 'root', y: 100, rotation: 90, length: 80 },
    { name: 'head', parent: 'body', x: 90 },
  ],
  slots: [
    { name: 'arm', bone: 'body', attachment: 'arm' },
    { name: 'head', bone: 'head', attachment: 'head', color: 'ffffff80' },
  ],
  skins: [{ name: 'default', attachments: {
    arm: { arm: { x: 10, y: 5, width: 20, height: 50 } },
    head: { head: { width: 64, height: 84 }, blink: { path: 'head', width: 64, height: 84 } },
  } }],
  animations: {
    idle: {
      bones: { head: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 20, curve: 'stepped' }, { time: 2, value: 0 }] } },
      slots: { head: { attachment: [{ time: 0.5, name: 'blink' }, { time: 0.6, name: 'head' }] } },
    },
    wave: { bones: { body: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.5, x: 10, y: 20 }] } } },
  },
  ik: [{ name: 'x', bones: ['body'], target: 'root' }],
};

test('Spine atlas: regions with sizes, trims and rotation', () => {
  const atlas = V.parseSpineAtlas(ATLAS);
  assert.deepEqual(atlas.get('head'), { name: 'head', page: 'hero.png', x: 2, y: 2, w: 60, h: 80, rotated: false, ox: 2, oy: 1, ow: 64, oh: 84 });
  assert.equal(atlas.get('arm').rotated, true);
  assert.equal(atlas.size, 2);
  // Spine 4 "bounds" form
  const b = V.parseSpineAtlas('p.png\nsize:64,64\nfilter:Linear,Linear\nx\nbounds:1,2,3,4\noffsets:0,0,5,6\n');
  assert.equal(b.get('x').w, 3);
  assert.equal(b.get('x').oh, 6);
});

test('Spine import: bones (y-down), parts, region attachments, motions and warnings', () => {
  const r = V.importSpine(SPINE, ATLAS, id);
  assert.equal(r.rig.bones.length, 3);
  const body = r.rig.bones.find((b) => b.name === 'body');
  assert.equal(body.y, -100, 'y is mirrored');
  assert.equal(body.rotation, -90, 'angles are mirrored');
  assert.equal(r.rig.bones.find((b) => b.name === 'head').parent, body.id);
  assert.equal(r.rig.parts.length, 2);
  const head = r.rig.parts.find((p) => p.name === 'head');
  assert.equal(head.attachments.length, 2);
  assert.equal(head.attachments[0].assetId, 'page:hero.png');
  assert.equal(head.attachments[0].region.w, 60);
  assert.ok(Math.abs(head.opacity - 0x80 / 255) < 1e-9);
  assert.deepEqual(r.images, ['page:hero.png']);
  assert.equal(r.rig.width, 200);
  assert.deepEqual(r.rig.origin, { x: 100, y: 290 });
  const idle = r.motions.find((m) => m.name === 'idle');
  assert.equal(idle.loop, true);
  assert.equal(idle.duration, 2);
  const rot = idle.tracks.find((t) => t.prop === 'rotation');
  assert.equal(rot.keys[1].v, -20);
  assert.equal(rot.keys[1].ease, 'step');
  const att = idle.tracks.find((t) => t.prop === 'attachment');
  assert.deepEqual(att.keys.map((k) => k.v), ['blink', 'head']);
  const wave = r.motions.find((m) => m.name === 'wave');
  assert.equal(wave.loop, false);
  assert.equal(wave.tracks.find((t) => t.prop === 'y').keys[1].v, -20);
  assert.ok(r.warnings.includes('constraints'));
  // Without an atlas, images are files.
  assert.ok(V.importSpine(SPINE, null, id).images.includes('file:head'));
});

function testCharacter() {
  const rig = {
    width: 200, height: 300, origin: { x: 100, y: 300 },
    bones: [
      { id: 'b_root', name: 'root', parent: null, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, length: 0 },
      { id: 'b_arm', name: 'arm', parent: 'b_root', x: 0, y: -200, rotation: 0, scaleX: 1, scaleY: 1, length: 50 },
    ],
    parts: [
      { id: 'p_body', name: 'body', bone: 'b_root', attachments: [{ name: 'body', assetId: 'ast_1', x: 0, y: -150, rotation: 0, scaleX: 1, scaleY: 1, width: 200, height: 300 }], attachment: 'body', opacity: 1 },
      { id: 'p_hand', name: 'hand', bone: 'b_arm', attachments: [{ name: 'open', assetId: 'ast_2', x: 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 20, height: 20 }, { name: 'fist', assetId: 'ast_3', x: 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 20, height: 20 }], attachment: 'open', opacity: 1 },
    ],
  };
  return {
    id: 'chr_1', name: 'Mia', color: '#fff', portraits: [{ id: 'prt_1', name: 'smile', assetId: 'ast_9' }], rig,
    motions: [
      { id: 'mot_idle', name: 'idle', kind: 'rig', duration: 2, loop: true, tracks: [{ target: 'bone', id: 'b_arm', prop: 'rotation', keys: [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: 90, ease: 'linear' }, { t: 2, v: 0, ease: 'linear' }] }] },
      { id: 'mot_wave', name: 'wave', kind: 'rig', duration: 1, loop: false, tracks: [{ target: 'part', id: 'p_hand', prop: 'attachment', keys: [{ t: 0, v: 'fist' }] }, { target: 'bone', id: 'b_arm', prop: 'scaleX', keys: [{ t: 0, v: 2 }] }] },
      { id: 'mot_run', name: 'run', kind: 'frames', duration: 0, loop: true, frames: ['ast_10', 'ast_11', 'ast_12'], fps: 10 },
    ],
    expressions: [{ id: 'exp_1', name: 'angry', parts: { p_hand: { attachment: 'fist', opacity: 0.5 } }, bones: { b_arm: { rotation: 10 } }, portraitId: 'prt_1' }],
    defaultMotion: 'mot_idle',
  };
}

test('rig pose: rest, motion (added / multiplied), expression, world matrices and hit test', () => {
  const ch = testCharacter();
  const rest = V.rigPose(ch.rig);
  const w = V.boneWorlds(ch.rig, rest);
  assert.deepEqual([w.get('b_arm')[4], w.get('b_arm')[5]], [100, 100], 'arm joint in the box');
  const half = V.rigPose(ch.rig, ch.motions[0], 0.5);
  assert.equal(half.bones.get('b_arm').rotation, 45);
  const looped = V.rigPose(ch.rig, ch.motions[0], 2.5);
  assert.equal(looped.bones.get('b_arm').rotation, 45, 'loops');
  const angry = V.rigPose(ch.rig, ch.motions[0], 0.5, ch.expressions[0]);
  assert.equal(angry.bones.get('b_arm').rotation, 55, 'expression adds to the pose');
  assert.equal(angry.parts.get('p_hand').attachment, 'fist');
  assert.equal(angry.parts.get('p_hand').opacity, 0.5);
  const wave = V.rigPose(ch.rig, ch.motions[1], 0.2);
  assert.equal(wave.bones.get('b_arm').scaleX, 2, 'scale multiplies');
  // The hand sits 40px along the arm: at 90° (clockwise, y-down) it points down.
  const p = V.rigPose(ch.rig, ch.motions[0], 1);
  assert.equal(V.hitRigPart(ch.rig, p, 100, 140), 'p_hand');
  assert.equal(V.hitRigPart(ch.rig, p, 140, 100), 'p_body');
  assert.equal(V.hitRigPart(ch.rig, p, 500, 500), null);
  assert.equal(V.sampleRigTrack({ keys: [{ t: 0, v: 0, ease: 'step' }, { t: 1, v: 5 }] }, 0.9), 0);
});

test('character frames: idle fallback after a one-shot motion, image sequences, portraits', () => {
  const ch = testCharacter();
  assert.equal(V.motionDuration(ch.motions[2]), 0.3);
  const f = V.characterFrame(ch, 'mot_run', null, 0.15);
  assert.deepEqual(f, { kind: 'frame', assetId: 'ast_11' });
  const during = V.characterFrame(ch, 'mot_wave', null, 0.5);
  assert.equal(during.pose.parts.get('p_hand').attachment, 'fist');
  const after = V.characterFrame(ch, 'mot_wave', null, 1.5);
  assert.equal(after.pose.parts.get('p_hand').attachment, 'open', 'back to idle');
  assert.equal(after.pose.bones.get('b_arm').rotation, 45, 'idle time starts when the one-shot ends');
  const none = V.characterFrame(ch, null, null, 0.5);
  assert.equal(none.pose.bones.get('b_arm').rotation, 45, 'no motion = idle');
  const noRig = { ...ch, rig: null, motions: [] };
  assert.deepEqual(V.characterFrame(noRig, null, 'exp_1', 0), { kind: 'portrait', portraitId: 'prt_1' });
});

test('timeline: clock props report the time since their key; character element size and blocks', () => {
  const p = V.createProject('Rig');
  const layer = V.createLayer(engine, p, 'core.character', 'Mia', { characterId: 'chr_1' });
  const clip = { ...V.createAnimation('c', 4), tracks: [{ id: 't', layerId: layer.id, prop: 'motion', keyframes: [{ id: 'k1', t: 0.5, v: 'mot_idle', ease: 'linear' }, { id: 'k2', t: 2, v: 'mot_wave', ease: 'linear' }] }] };
  const propDef = (_id, key) => engine.layerProps('core.character').find((d) => d.key === key);
  const at = (t) => V.sampleClip(engine, clip, t, propDef).get(layer.id);
  assert.equal(at(1).motion, 'mot_idle');
  assert.equal(at(1).motionSince, 0.5);
  assert.equal(at(2.25).motion, 'mot_wave');
  assert.equal(at(2.25).motionSince, 0.25);
  const def = engine.layerTypes.get('core.character');
  const ch = testCharacter();
  const size = def.size(layer, { ...layer.props, height: 600 }, { project: { characters: [ch], assets: [] }, assets: { asset: () => null } });
  assert.deepEqual(size, { width: 400, height: 600 }, 'rig box scaled to the height');
  assert.ok(engine.blocks.get('core.playMotion'));
  assert.ok(engine.blocks.get('core.setExpression'));
  assert.equal(V.PROJECT_FORMAT_VERSION, 6);
  assert.equal(V.ENGINE_VERSION, '1.2.0');
});

test('library: save copies asset files, load imports them into another project and maps ids', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vne-lib-'));
  const projA = path.join(tmp, 'a'), projB = path.join(tmp, 'b');
  mkdirSync(path.join(projA, 'assets/images'), { recursive: true });
  mkdirSync(projB, { recursive: true });
  writeFileSync(path.join(projA, 'assets/images/bg.png'), Buffer.from('fake-png-a'));
  const asset = { id: 'ast_bg', name: 'bg.png', kind: 'image', path: 'assets/images/bg.png', tags: [], meta: {} };
  const lib = new V.LibraryStore(path.join(tmp, 'library'));
  const saved = await lib.save('scene', { id: 'scp_1', name: 'Street', data: { layers: [{ id: 'lyr_1', props: { assetId: 'ast_bg' } }] } }, projA, [asset, { ...asset, id: 'ast_gone', path: 'assets/images/gone.png' }]);
  assert.equal(saved.assets.length, 1, 'missing files are left out');
  assert.ok(existsSync(path.join(tmp, 'library/scene/scp_1/files/ast_bg.png')));
  assert.equal((await lib.list('scene')).length, 1);
  const loaded = await lib.load('scene', 'scp_1', projB, []);
  assert.equal(loaded.assets.length, 1);
  const newId = loaded.map.ast_bg;
  assert.ok(newId && newId !== 'ast_bg');
  assert.equal(readFileSync(path.join(projB, loaded.assets[0].path), 'utf8'), 'fake-png-a');
  // Loading again reuses the same file.
  const again = await lib.load('scene', 'scp_1', projB, loaded.assets);
  assert.equal(again.assets.length, 0);
  assert.equal(again.map.ast_bg, newId);
  await lib.rename('scene', 'scp_1', 'Night street');
  assert.equal((await lib.list('scene'))[0].name, 'Night street');
  await assert.rejects(() => lib.save('scene', { id: '../x', name: 'x', data: {} }, projA, []));
  await assert.rejects(() => lib.list('nope'));
  await lib.remove('scene', 'scp_1');
  assert.equal((await lib.list('scene')).length, 0);
});
