/**
 * Builds examples/games/like-human/project.vne.json from code, using the same
 * core library as the editor. Run through ./make.mjs (it bundles this file).
 *
 * The result is an ordinary project: open it in the editor and change anything.
 * Ids are fixed strings so that regenerating produces a stable diff.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createProject, createSceneData, createLayer, I18n, validateProject, serializeProject,
  type Project, type StoryNode, type Layer, type AnimationClip, type Track, type Block, type ScriptStack, type Choice, type Expr, type DialogueLine, type EffectGraph,
} from '@vne/core';
import { createEngine, ModuleHost } from '@vne/runtime';
import { EFFECT_PRESETS } from '../../../../packages/editor/src/effects/presets';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: build-project <game-folder>');

const engine = createEngine();
const p: Project = createProject('Like Human');
const { width: W, height: H } = p.settings.resolution;

/* ---------------------------------------------------------------- assets */
const KIND: Record<string, 'image' | 'audio' | 'video'> = { '.png': 'image', '.ogg': 'audio', '.webm': 'video' };
const A: Record<string, string> = {};
for (const sub of ['images', 'audio', 'video']) {
  const dir = path.join(OUT, 'assets', sub);
  for (const f of readdirSync(dir).sort()) {
    const ext = path.extname(f);
    const kind = KIND[ext];
    if (!kind) continue;
    const file = path.join(dir, f);
    const buf = readFileSync(file);
    const name = path.basename(f, ext);
    const meta: Record<string, number> = {};
    if (kind === 'image') { meta.width = buf.readUInt32BE(16); meta.height = buf.readUInt32BE(20); }
    else {
      const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
      meta.duration = Math.round(Number(d) * 100) / 100;
      if (kind === 'video') {
        const [vw, vh] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
        meta.width = vw; meta.height = vh;
      }
    }
    const id = `ast_${name}`;
    A[name] = id;
    p.assets.push({ id, name, kind, path: `assets/${sub}/${f}`, size: statSync(file).size, hash: createHash('sha1').update(buf).digest('hex'), tags: [sub === 'images' ? (name.startsWith('bg_') ? 'background' : name === 'icon' ? 'ui' : 'character') : name.split('_')[0]], meta, imported: '2026-11-19T00:00:00.000Z' });
  }
}

/* ---------------------------------------------------------------- settings */
Object.assign(p, { id: 'prj_like_human', created: '2026-11-19T00:00:00.000Z' });
p.settings.title = 'Like Human';
p.settings.author = 'Visual Novel Editor examples';
p.settings.identifier = 'com.example.likehuman';
p.settings.description = 'A short story about an android and the engineer who built her. Shows every major feature: branching, conditions, cross-chapter jumps, animation, effects, scripts and modules.';
p.settings.iconAssetId = A.icon;
p.settings.titleScreen = { backgroundAssetId: A.bg_title, musicAssetId: A.bgm_lab, showTitle: true };
p.settings.textbox.showPortrait = false;

/* ---------------------------------------------------------------- data */
const ch1 = p.chapters[0];
Object.assign(ch1, { id: 'chp_awakening', name: 'Awakening', color: '#5aa9e6' });
const ch2 = { id: 'chp_city', name: 'The City', color: '#b388ff' };
p.chapters.push(ch2);
p.editor = { views: {}, lastChapterId: ch1.id };

p.variables.push(
  { id: 'var_empathy', name: 'empathy', type: 'number', initial: 0, scope: 'game', description: 'How well Seven understands people. Raised by choices.' },
  { id: 'var_met', name: 'metMika', type: 'boolean', initial: false, scope: 'game', description: 'Set by the "Calibrate" event.' },
  { id: 'var_end_human', name: 'endingHuman', type: 'boolean', initial: false, scope: 'persistent', description: 'Unlocked when the "Like Human" ending is reached (kept across playthroughs).' },
  { id: 'var_end_machine', name: 'endingMachine', type: 'boolean', initial: false, scope: 'persistent' },
  { id: 'var_end_shutdown', name: 'endingShutdown', type: 'boolean', initial: false, scope: 'persistent' },
);

const MIKA = 'chr_mika', SEVEN = 'chr_seven';
p.characters.push(
  { id: MIKA, name: 'Mika', color: '#ff8fb8', description: 'Robotics engineer. Talks to machines like they are people.', portraits: ['neutral', 'smile', 'surprised', 'sad'].map((n) => ({ id: `por_mika_${n}`, name: n, assetId: A[`mika_${n}`] })) },
  { id: SEVEN, name: 'Seven', color: '#7ff3ff', description: 'Prototype android, unit 7. Learning what feelings are.', portraits: ['neutral', 'smile', 'glitch'].map((n) => ({ id: `por_seven_${n}`, name: n, assetId: A[`seven_${n}`] })) },
);

/* ---------------------------------------------------------------- modules */
const MODULES = ['com.example.relationships', 'com.example.timed-choices', 'com.example.speech-bubble', 'com.example.wobble', 'com.example.retro-fx', 'com.example.extra-blocks', 'com.example.dice-check'];
for (const id of MODULES) p.modules.push({ id, version: '^1.0.0', enabled: true });
p.extensions['com.example.relationships'] = { showMeter: true, characters: { [MIKA]: { tracked: true, start: 2, max: 10, threshold: 5 } } };
const REL = 'com.example.relationships';

/* ---------------------------------------------------------------- helpers */
let seq = 0;
const uid = (prefix: string) => `${prefix}_${(++seq).toString(36).padStart(3, '0')}`;
const lit = (v: any): Expr => ({ k: 'lit', v });
const v = (id: string): Expr => ({ k: 'var', id });
const op = (o: any, a: Expr, b: Expr): Expr => ({ k: 'op', op: o, a, b });

function node(type: string, chapterId: string, id: string, name: string, x: number, y: number, data: any = {}): StoryNode {
  const def = engine.nodeTypes.get(type);
  // Layout coordinates below are on a compact grid; spread them so nodes do not touch.
  const n: StoryNode = { id, type, chapterId, name, x: Math.round(x * 1.15), y: Math.round(y * 1.15), data: { ...(def ? def.createData(p) : {}), ...data }, modules: [] };
  p.nodes[id] = n;
  return n;
}
function edge(from: string, fromPort: string, to: string, toPort = 'in'): void {
  p.edges.push({ id: `edg_${from}_${fromPort}_${to}`.replace(/[^a-z0-9_]/gi, '_'), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
}
function layer(type: string, name: string, props: Record<string, any> = {}, extra: Partial<Layer> = {}): Layer {
  const l = createLayer(engine, p, type, name, props);
  l.id = uid('lyr');
  return Object.assign(l, extra);
}
/** A module-defined layer (its type is registered by the module at load time). */
function modLayer(type: string, name: string, props: Record<string, any>): Layer {
  return { id: uid('lyr'), type, name, parentId: null, visible: true, locked: false, effect: null, props: { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1, ...props } };
}
function bg(asset: string): Layer { return layer('core.background', 'Background', { assetId: A[asset] }); }
function charLayer(charId: string, portrait: string, x: number, name?: string, extra: Record<string, any> = {}): Layer {
  return layer('core.character', name || (charId === MIKA ? 'Mika' : 'Seven'), { characterId: charId, portraitId: portrait, x, height: 640, ...extra });
}
function line(text: string, speaker: string | null = null, portrait: string | null = null, extra: Partial<DialogueLine> = {}): DialogueLine {
  return { id: uid('ln'), speakerId: speaker, portraitId: portrait, text, ...extra };
}
function choice(id: string, text: string, extra: Partial<Choice> = {}): Choice {
  return { id, text, condition: null, hidden: false, unavailable: 'hide', effects: [], animationId: null, ...extra };
}
type K = [number, any, string?];
function clip(name: string, duration: number, tracks: [string, string, K[]][], extra: Partial<AnimationClip> = {}): AnimationClip {
  return {
    id: uid('anm'), name, duration, loop: false, autoplay: false, media: [],
    tracks: tracks.map(([layerId, prop, keys]): Track => ({ id: uid('trk'), layerId, prop, keyframes: keys.map(([t, val, ease]) => ({ id: uid('key'), t, v: val, ease: ease || 'easeInOut' })) })),
    ...extra,
  };
}
const B = (type: string, args: Record<string, any> = {}, body?: Block[]): Block => ({ id: uid('blk'), type, args, ...(body ? { body } : {}) });
function stack(hat: Block, body: Block[], x = 40, y = 40): ScriptStack { return { id: uid('stk'), x, y, enabled: true, hat, body }; }
function scene(chapterId: string, id: string, name: string, number: string, x: number, y: number, build: (d: ReturnType<typeof createSceneData>) => void): StoryNode {
  const d = createSceneData(number);
  build(d);
  return node('core.scene', chapterId, id, name, x, y, d);
}
function inlineFx(graph: EffectGraph): any { return { kind: 'inline', graph }; }
function fxGraph(name: string, nodes: { key: string; type: string; x: number; y: number; values?: any }[], edges: [string, string, string, string][]): EffectGraph {
  const ids = new Map(nodes.map((n) => [n.key, uid('fxn')]));
  return {
    id: uid('fxg'), name, params: [],
    nodes: nodes.map((n) => ({ id: ids.get(n.key)!, type: n.type, x: n.x, y: n.y, values: n.values || {} })),
    edges: edges.map(([a, ap, b2, bp]) => ({ id: uid('fxe'), from: { node: ids.get(a)!, port: ap }, to: { node: ids.get(b2)!, port: bp } })),
  };
}

/* ---------------------------------------------------------------- shared resources */
// A project effect graph used by reference (edit once, every user updates).
const oldFilm = EFFECT_PRESETS.find((x) => x.id === 'oldfilm')!.make();
oldFilm.id = 'fxg_old_film';
oldFilm.name = 'Old film';
p.effectGraphs.push(oldFilm);

// A reusable behavior (script) run from several scenes.
p.behaviors.push({ id: 'bhv_glitch', name: 'Glitch', body: [
  B('core.playSound', { asset: A.sfx_glitch, volume: 0.8 }),
  B('core.flashScreen', { color: '#7ff3ff', seconds: 0.25 }),
  B('core.shakeScreen', { intensity: 14, seconds: 0.4 }),
] });

// A reusable composition: a chapter title card.
const cardBar = layer('core.shape', 'Bar', { x: 0, y: 0, anchorX: 0, anchorY: 0, width: 640, height: 4, fill: '#b388ff' });
const cardTitle = layer('core.text', 'Title', { x: 0, y: 24, anchorX: 0, anchorY: 0, text: 'Chapter 2', fontSize: 28, color: '#b388ff', fontWeight: '600', width: 640 });
const cardSub = layer('core.text', 'Subtitle', { x: 0, y: 64, anchorX: 0, anchorY: 0, text: 'The City', fontSize: 64, color: '#ffffff', fontWeight: 'bold', width: 640, shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 12 });
p.compositions.push({ id: 'cmp_title_card', name: 'Chapter title card', width: 640, height: 160, layers: [cardBar, cardTitle, cardSub] });

/* ================================================================ Chapter 1 */
node('core.start', ch1.id, 'nod_start', 'Start', 0, 240);

// 1 — Boot sequence: the scripted interaction from the spec lives here.
const S1 = scene(ch1.id, 'scn_boot', 'Boot sequence', '1', 300, 200, (d) => {
  const back = bg('bg_lab');
  const dust = layer('core.particles', 'Dust', { kind: 'dust', count: 60, speed: 0.4, color: '#bff8ff' });
  const mika = charLayer(MIKA, 'por_mika_surprised', 900, 'Mika', { wobble: 0, float: 0 });
  const hud = layer('core.text', 'Boot text', { x: 40, y: 36, anchorX: 0, anchorY: 0, text: 'UNIT 7 // VISUAL INPUT ONLINE', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 22, color: '#7ff3ff', width: 700, reveal: 0 });
  const bubble = modLayer('com.example.speech-bubble/bubble', 'Hint bubble', { x: 1010, y: 150, anchorX: 0.2, anchorY: 1, text: 'Psst… click me!', width: 240, fontSize: 24, tail: 'bottomLeft', style: 'speech', pop: 0, fill: '#ffffff', textColor: '#1d1d27' });
  const music = layer('core.audio', 'Lab music', { assetId: A.bgm_lab, category: 'bgm', autoplay: true, loop: true, volume: 0.6, persist: true });
  d.layers.push(back, dust, mika, bubble, hud, music);
  // "Opening the eyes": a slow fade in from black.
  d.transition = { type: 'fade', duration: 2.2 };
  bubble.visible = false;
  const open = clip('Boot', 3, [
    [hud.id, 'reveal', [[0.8, 0, 'linear'], [2.4, 1]]],
    [mika.id, 'x', [[0.6, 1040, 'easeOut'], [2.6, 900]]],
  ], { autoplay: true });
  const wave = clip('Mika waves', 1.2, [
    [mika.id, 'wobble', [[0, 0, 'com.example.wobble/smoothstep'], [0.3, 1, 'com.example.wobble/smoothstep'], [1.2, 0]]],
    [mika.id, 'rotation', [[0, 0, 'easeOut'], [0.25, -3, 'easeInOut'], [0.6, 3, 'easeInOut'], [1.2, 0]]],
  ]);
  d.animations.push(open, wave);
  d.dialogue.push(
    line('…Signal detected. Visual input online.', null, null, { speakerName: 'SYSTEM' }),
    line('Oh! You’re awake. Can you hear me?', MIKA, 'por_mika_surprised'),
    line('I’m Mika. I built you — well, most of you.', MIKA, 'por_mika_smile'),
    line('Try something for me. Say anything. Or… do anything.', MIKA, 'por_mika_neutral'),
  );
  d.choices.push(
    choice('cho_hello', 'Hello, Mika.', { effects: [{ varId: 'var_empathy', op: 'add', value: 1 }] }),
    choice('cho_silent', '( Stay silent )'),
    choice('cho_hand', 'Take her hand.', { hidden: true, effects: [{ varId: 'var_empathy', op: 'add', value: 2 }] }),
  );
  // Click Mika → she waves, affection +1, short wait, then the hidden choice appears.
  d.scripts.push(stack(B('core.whenLayerClicked', { layer: mika.id }), [
    B('core.playAnimation', { anim: wave.id, wait: true }),
    B(`${REL}/change`, { character: MIKA, delta: 1 }),
    B('core.playSound', { asset: A.sfx_beep, volume: 0.7 }),
    B('core.wait', { seconds: 0.4 }),
    B('core.showChoice', { choice: 'cho_hand' }),
    B('core.hide', { layer: bubble.id }),
    B('com.example.extra-blocks/notify', { text: 'New option: Take her hand', seconds: 2.5 }),
  ], 40, 40));
  // When the dialogue ends, pop up the hint bubble with an overshoot tween.
  d.scripts.push(stack(B('core.whenDialogueEnds'), [
    B('core.wait', { seconds: 1.5 }),
    B('core.show', { layer: bubble.id }),
    B('core.tweenProp', { layer: bubble.id, prop: 'pop', value: 1, seconds: 0.5, ease: 'backOut', wait: false }),
  ], 460, 40));
});
edge('nod_start', 'out', S1.id);

// 2 — First words
const S2 = scene(ch1.id, 'scn_first_words', 'First words', '2', 620, 100, (d) => {
  const mika = charLayer(MIKA, 'por_mika_smile', 900);
  d.layers.push(bg('bg_lab'), layer('core.particles', 'Dust', { kind: 'dust', count: 60, speed: 0.4, color: '#bff8ff' }), mika);
  d.dialogue.push(
    line('You did it! Your voice module works.', MIKA, 'por_mika_smile'),
    line('Empathy calibration: {empathy}.', null, null, { speakerName: 'SYSTEM' }),
    line('Come on. There’s something I want to show you.', MIKA, 'por_mika_neutral'),
  );
});
edge(S1.id, 'c:cho_hello', S2.id);
edge(S1.id, 'c:cho_hand', S2.id);

// 3 — Silence: glitch effect, reusable behavior, retro-fx effect node.
const S3 = scene(ch1.id, 'scn_silence', 'Silence', '3', 620, 360, (d) => {
  const mika = charLayer(MIKA, 'por_mika_sad', 420);
  const seven = charLayer(SEVEN, 'por_seven_glitch', 900);
  seven.effect = inlineFx(fxGraph('Glitch scanlines', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 },
    { key: 'chroma', type: 'fx.chromatic', x: 260, y: 80, values: { amount: 6 } },
    { key: 'scan', type: 'com.example.retro-fx/scanlines', x: 500, y: 80, values: { spacing: 4, darkness: 0.45, roll: 30 } },
    { key: 'out', type: 'fx.output', x: 760, y: 80 },
  ], [['in', 'image', 'chroma', 'image'], ['chroma', 'image', 'scan', 'image'], ['scan', 'image', 'out', 'image']]));
  d.layers.push(bg('bg_lab'), mika, seven);
  d.dialogue.push(
    line('[ERROR] Response buffer empty.', SEVEN, 'por_seven_glitch'),
    line('Nothing? …That’s okay. Silence is an answer too.', MIKA, 'por_mika_sad'),
    line('Let’s run the calibration anyway.', MIKA, 'por_mika_neutral'),
  );
  d.scripts.push(stack(B('core.whenSceneStarts'), [B('core.wait', { seconds: 0.3 }), B('core.runBehavior', { behavior: 'bhv_glitch' })]));
});
edge(S1.id, 'c:cho_silent', S3.id);

// Event → Condition → (Jump to chapter 2 | dice check)
const EV = node('core.event', ch1.id, 'nod_calibrate', 'Calibrate', 940, 100, { actions: [
  B('core.setVar', { variable: 'var_met', value: true }),
  B('core.log', { value: lit('Calibration finished') }),
] });
edge(S2.id, 'next', EV.id);
const COND = node('core.condition', ch1.id, 'nod_empathy_check', 'Empathy ≥ 2?', 1200, 220, { expr: op('>=', v('var_empathy'), lit(2)) });
edge(EV.id, 'out', COND.id);
edge(S3.id, 'next', COND.id);
const J1 = node('core.jumpIn', ch1.id, 'nod_jump_city', 'To the city', 1480, 120, { number: 1 });
edge(COND.id, 'true', J1.id);

const ROLL = node(`com.example.dice-check/rollDice`, ch1.id, 'nod_roll', 'Roll d20 + empathy', 1200, 470, { count: 1, sides: 20, modifierVar: 'var_empathy' });
const CHECK = node(`com.example.dice-check/skillCheck`, ch1.id, 'nod_skill', 'Calibration check', 1480, 330, { difficulty: 8, resultVar: null });
edge(COND.id, 'false', CHECK.id);
edge(ROLL.id, 'roll', CHECK.id, 'bonus');
edge(CHECK.id, 'success', J1.id);
const SHUT = scene(ch1.id, 'scn_shutdown', 'Shutdown', '4', 1760, 420, (d) => {
  const lids = layer('core.shape', 'Fade', { x: W / 2, y: H / 2, width: W, height: H, fill: '#000000', opacity: 0 });
  d.layers.push(bg('bg_lab'), charLayer(MIKA, 'por_mika_sad', 640), lids);
  d.animations.push(clip('Fade out', 4, [[lids.id, 'opacity', [[1.5, 0, 'easeIn'], [4, 1]]]], { autoplay: true }));
  d.dialogue.push(line('Calibration failed. Entering sleep mode.', null, null, { speakerName: 'SYSTEM' }), line('Goodnight, Seven. We’ll try again.', MIKA, 'por_mika_sad'));
});
edge(CHECK.id, 'failure', SHUT.id);
const END_SHUT = node('core.ending', ch1.id, 'nod_end_shutdown', 'Ending: Sleep mode', 2040, 440, { label: 'Sleep Mode', behavior: 'title', message: 'Seven went back to sleep. Try being a little more… human.', unlockVarId: 'var_end_shutdown' });
edge(SHUT.id, 'next', END_SHUT.id);

node('core.comment', ch1.id, 'nod_note1', 'Note', 300, 520, { text: 'Click Mika in “Boot sequence” to reveal a hidden choice (see its Scripts tab).\nThe dice check uses the Dice Check module.', width: 420, height: 110 });

/* ================================================================ Chapter 2 */
const JO = node('core.jumpOut', ch2.id, 'nod_from_lab', 'From the lab', 0, 240, { number: 1 });

const S5 = scene(ch2.id, 'scn_rooftop', 'Rooftop', '5', 300, 200, (d) => {
  const rain = layer('core.particles', 'Rain', { kind: 'rain', count: 220, speed: 1.2, color: '#9fb6ff' });
  const mika = charLayer(MIKA, 'por_mika_neutral', 400);
  const seven = charLayer(SEVEN, 'por_seven_neutral', 880, 'Seven', { float: 6 });
  const card = layer('core.composition', 'Title card', { compositionId: 'cmp_title_card', x: 80, y: 90, anchorX: 0, anchorY: 0, opacity: 0 });
  d.layers.push(bg('bg_rooftop'), rain, mika, seven, card,
    layer('core.audio', 'Rain', { assetId: A.amb_rain, category: 'ambient', autoplay: true, loop: true, volume: 0.35, persist: false }),
    layer('core.audio', 'City music', { assetId: A.bgm_city, category: 'bgm', autoplay: true, loop: true, volume: 0.6, persist: true }));
  d.animations.push(clip('Title card', 4.5, [
    [card.id, 'opacity', [[0.3, 0, 'easeOut'], [1.2, 1, 'linear'], [3.4, 1, 'easeIn'], [4.4, 0]]],
    [card.id, 'x', [[0.3, 40, 'easeOut'], [1.4, 80]]],
  ], { autoplay: true }));
  d.transition = { type: 'com.example.retro-fx/pixels', duration: 1.2, params: { block: 32 } };
  d.dialogue.push(
    line('This is the city I grew up in.', MIKA, 'por_mika_neutral'),
    line('It is very loud. And very bright. And wet.', SEVEN, 'por_seven_neutral'),
    line('Ha! That’s the rain. Do you like it?', MIKA, 'por_mika_smile'),
  );
  d.choices.push(
    choice('cho_like_you', 'I like it, because you are here.'),
    choice('cho_learning', 'I do not understand “like” yet.', { effects: [{ varId: 'var_empathy', op: 'add', value: 1 }] }),
  );
});
edge(JO.id, 'out', S5.id);

const S6a = scene(ch2.id, 'scn_blush', 'Because you are here', '6', 620, 100, (d) => {
  d.layers.push(bg('bg_rooftop'), charLayer(MIKA, 'por_mika_surprised', 400), charLayer(SEVEN, 'por_seven_smile', 880, 'Seven', { float: 6 }), layer('core.particles', 'Sparkles', { kind: 'sparkle', count: 40, color: '#ffd27a' }));
  d.dialogue.push(line('…Oh.', MIKA, 'por_mika_surprised'), line('Where did you learn to say things like that?', MIKA, 'por_mika_smile'));
});
S6a.modules.push({ id: 'mi_aff_blush', moduleId: REL, component: `${REL}/onEnter`, enabled: true, data: { characterId: MIKA, delta: 2 } });
const S6b = scene(ch2.id, 'scn_learning', 'Learning', '7', 620, 360, (d) => {
  d.layers.push(bg('bg_rooftop'), layer('core.particles', 'Rain', { kind: 'rain', count: 220, speed: 1.2, color: '#9fb6ff' }), charLayer(MIKA, 'por_mika_smile', 400), charLayer(SEVEN, 'por_seven_neutral', 880, 'Seven', { float: 6 }));
  d.dialogue.push(line('That’s fine. Nobody really does.', MIKA, 'por_mika_smile'), line('You learn it by noticing what you miss when it’s gone.', MIKA, 'por_mika_neutral'));
});
edge(S5.id, 'c:cho_like_you', S6a.id);
edge(S5.id, 'c:cho_learning', S6b.id);

// Memory: video layer, shared "Old film" effect by reference, timed choices module.
const S7 = scene(ch2.id, 'scn_memory', 'Memory', '8', 940, 220, (d) => {
  const back = bg('bg_memory');
  back.effect = { kind: 'ref', graphId: 'fxg_old_film', params: {} };
  const tv = layer('core.video', 'Old TV', { assetId: A.memory_lights, x: 650, y: 400, width: 260, height: 146, autoplay: true, loop: true, muted: true, volume: 0 });
  const frame = layer('core.shape', 'TV frame', { x: 650, y: 400, width: 280, height: 166, fill: 'rgba(0,0,0,0)', stroke: '#2b1b18', strokeWidth: 10, radius: 12 });
  const mika = charLayer(MIKA, 'por_mika_neutral', 1000, 'Mika', { dim: 0 });
  d.layers.push(back, tv, frame, mika, layer('core.particles', 'Dust', { kind: 'dust', count: 40, color: '#ffd9a0' }));
  d.dialogue.push(
    line('When I was little, my father repaired old TVs in this room.', MIKA, 'por_mika_neutral'),
    line('He said every machine has a little bit of its maker inside.', MIKA, 'por_mika_smile'),
    line('Then he got sick. And the room got very quiet.', MIKA, 'por_mika_sad'),
    line('She is reaching for your hand.', null, null, { speakerName: '' }),
  );
  d.choices.push(choice('cho_hold', 'Hold her hand.', { effects: [{ varId: 'var_empathy', op: 'add', value: 1 }] }), choice('cho_wait', '( Do nothing )'));
});
S7.modules.push({ id: 'mi_timer_memory', moduleId: 'com.example.timed-choices', component: 'com.example.timed-choices/timer', enabled: true, data: { seconds: 8, defaultChoice: 'cho_wait', color: '#ffcc66' } });
edge(S6a.id, 'next', S7.id);
edge(S6b.id, 'next', S7.id);

// The hold-hand choice also raises affection through a script block.
(S7.data as any).scripts.push(stack(B('core.whenChoiceSelected', { choice: 'cho_hold' }), [B(`${REL}/change`, { character: MIKA, delta: 2 })]));

const BR = node(`${REL}/branch`, ch2.id, 'nod_affection', 'Does Mika trust Seven?', 1240, 240, { characterId: MIKA, threshold: null });
edge(S7.id, 'c:cho_hold', BR.id);
edge(S7.id, 'c:cho_wait', BR.id);

const S8 = scene(ch2.id, 'scn_dawn', 'Dawn', '9', 1520, 100, (d) => {
  const mika = charLayer(MIKA, 'por_mika_smile', 420);
  const seven = charLayer(SEVEN, 'por_seven_smile', 860);
  const glow = layer('core.shape', 'Sun glow', { x: 980, y: 400, width: 900, height: 900, shape: 'ellipse', fill: '#fff3c4', gradient: 'radial', fill2: 'rgba(255,243,196,0)', opacity: 0.5 });
  d.layers.push(bg('bg_dawn'), glow, layer('core.particles', 'Petals', { kind: 'petals', count: 50, color: '#ffc4d6' }), mika, seven,
    layer('core.audio', 'Ending music', { assetId: A.bgm_ending, category: 'bgm', autoplay: true, loop: true, volume: 0.7, persist: true }));
  d.animations.push(clip('Sunrise', 6, [[glow.id, 'opacity', [[0, 0.2, 'easeInOut'], [6, 0.6]]], [glow.id, 'scaleX', [[0, 0.8, 'easeOut'], [6, 1.1]]], [glow.id, 'scaleY', [[0, 0.8, 'easeOut'], [6, 1.1]]]], { autoplay: true }));
  d.transition = { type: 'fade', duration: 1.5 };
  d.dialogue.push(
    line('We stayed until the sun came up.', null, null, { speakerName: '' }),
    line('Mika. I think this is what you call “happy”.', SEVEN, 'por_seven_smile'),
    line('Yeah. I think it is.', MIKA, 'por_mika_smile'),
  );
  d.scripts.push(stack(B('core.whenLineShown', { line: d.dialogue[1].id }), [B('core.playSound', { asset: A.sfx_chime, volume: 0.6 })]));
});
const S9 = scene(ch2.id, 'scn_rain', 'Rain', '10', 1520, 380, (d) => {
  d.layers.push(bg('bg_rooftop'), layer('core.particles', 'Rain', { kind: 'rain', count: 320, speed: 1.4, color: '#9fb6ff' }), charLayer(SEVEN, 'por_seven_neutral', 640));
  d.dialogue.push(line('Mika went home early.', null, null, { speakerName: '' }), line('Rain: 100%. Understanding: 12%. Logging for tomorrow.', SEVEN, 'por_seven_neutral'));
});
edge(BR.id, 'high', S8.id);
edge(BR.id, 'low', S9.id);
const E1 = node('core.ending', ch2.id, 'nod_end_human', 'Ending: Like Human', 1820, 120, { label: 'Like Human', behavior: 'title', message: 'Thank you for playing.', unlockVarId: 'var_end_human' });
const E2 = node('core.ending', ch2.id, 'nod_end_machine', 'Ending: Just a Machine', 1820, 400, { label: 'Just a Machine', behavior: 'title', message: 'Some things take more than one try.', unlockVarId: 'var_end_machine' });
edge(S8.id, 'next', E1.id);
edge(S9.id, 'next', E2.id);
node('core.comment', ch2.id, 'nod_note2', 'Note', 940, 480, { text: 'Memory has a Timed Choices module (Modules tab) and uses the shared “Old film” effect.\nThe pink node is an Affection Branch from the Relationships module.', width: 440, height: 110 });

/* ---------------------------------------------------------------- validate with modules loaded */
const i18n = new I18n('en');
const host = new ModuleHost(engine, i18n, { mode: 'editor', onError: (id, err, where) => console.error(`module ${id} (${where}):`, err) });
const extDir = path.join(OUT, 'modules');
const sources = MODULES.map((id) => {
  const dir = path.join(extDir, id);
  return { manifest: JSON.parse(readFileSync(path.join(dir, 'module.json'), 'utf8')), baseUrl: pathToFileURL(dir + path.sep).href };
});
await host.loadAll(sources);
const statuses = new Map([...host.records.values()].map((r) => [r.manifest.id, { status: r.status === 'active' ? 'ok' as const : 'failed' as const, detail: r.error }]));
for (const [id, s] of statuses) if (s.status !== 'ok') throw new Error(`module ${id} failed: ${s.detail}`);
const issues = validateProject(engine, p, { moduleStatus: statuses });
for (const i of issues) console.log(`${i.severity}: ${i.code} ${JSON.stringify(i.params || {})} ${JSON.stringify(i.target || {})}`);
if (issues.some((i) => i.severity === 'error')) throw new Error('project has errors');

p.modified = '2026-11-19T00:00:00.000Z';
writeFileSync(path.join(OUT, 'project.vne.json'), serializeProject(p).replace(/"modified": "[^"]+"/, '"modified": "2026-11-19T00:00:00.000Z"'));
console.log(`project written: ${Object.keys(p.nodes).length} nodes, ${p.edges.length} edges, ${p.assets.length} assets, ${issues.length} notes`);
