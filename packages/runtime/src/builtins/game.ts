/**
 * Game module blocks: element transforms, page-change rules (inheritance), element
 * parameters, lists, labels, sprites (frame animation) and collectibles.
 */
import type { BlockDef, Engine } from '@vne/core';
import { toList, truthy, findItem, LEAVE_REMOVE_BLOCK, LEAVE_PAUSE_BLOCK } from '@vne/core';
import type { ScriptContext } from '../script';
import { findParam } from '../globals';
import { spriteFrames } from './layers';

const SPRITE = ['core.sprite'];
const IMAGES = ['core.image', 'core.background', 'core.sprite'];
const ANY = ['*'];
const n = (v: any) => Number(v) || 0;
const num = n;
const lit = (v: any) => ({ k: 'lit', v });

function scene(ctx: ScriptContext): any {
  const s = ctx.scene;
  if (!s) throw new Error('This block needs a playing scene');
  return s;
}

function asText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v ?? '');
}

/** Same item? (block argument: item id or name; event: item name and id). */
function sameItem(arg: unknown, e: { item?: unknown; itemId?: unknown; [k: string]: any }): boolean {
  if (arg === null || arg === undefined || arg === '') return true;
  const a = String(arg);
  return a === e.itemId || a.toLowerCase() === String(e.item ?? '').toLowerCase();
}

export function registerGameBlocks(engine: Engine): void {
  const B = (def: BlockDef) => engine.blocks.register(def, 'core');
  const L = { id: 'layer', type: 'layer' as const };
  const LIST = { id: 'variable', type: 'variable' as const, varType: 'list' as const };
  const ITEM = { id: 'item', type: 'item' as const };

  /* Transforms --------------------------------------------------------------- */
  B({ id: 'core.turnBy', category: 'game', shape: 'statement', label: 'block.turnBy', args: [L, { id: 'deg', type: 'expr', default: lit(15) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); s.setProp(a.layer, 'rotation', n(s.getProp(a.layer, 'rotation')) + n(a.deg)); } });
  B({ id: 'core.rotateTo', category: 'game', shape: 'statement', label: 'block.rotateTo', args: [L, { id: 'deg', type: 'expr', default: lit(0) }],
    run: (ctx: ScriptContext, a) => scene(ctx).setProp(a.layer, 'rotation', n(a.deg)) });
  B({ id: 'core.spinTo', category: 'game', shape: 'statement', label: 'block.spinTo', args: [L, { id: 'deg', type: 'expr', default: lit(360) }, { id: 'seconds', type: 'number', default: 1 }],
    run: (ctx: ScriptContext, a) => scene(ctx).tween(a.layer, 'rotation', n(a.deg), a.seconds, 'easeInOut', ctx.token) });
  B({ id: 'core.changeXY', category: 'game', shape: 'statement', label: 'block.changeXY', args: [L, { id: 'dx', type: 'expr', default: lit(10) }, { id: 'dy', type: 'expr', default: lit(0) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); s.setProp(a.layer, 'x', n(s.getProp(a.layer, 'x')) + n(a.dx)); s.setProp(a.layer, 'y', n(s.getProp(a.layer, 'y')) + n(a.dy)); } });
  B({ id: 'core.glideBy', category: 'game', shape: 'statement', label: 'block.glideBy', args: [L, { id: 'dx', type: 'expr', default: lit(100) }, { id: 'dy', type: 'expr', default: lit(0) }, { id: 'seconds', type: 'number', default: 1 }],
    async run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      await Promise.all([s.tween(a.layer, 'x', n(s.getProp(a.layer, 'x')) + n(a.dx), a.seconds, 'easeInOut', ctx.token), s.tween(a.layer, 'y', n(s.getProp(a.layer, 'y')) + n(a.dy), a.seconds, 'easeInOut', ctx.token)]);
    } });
  B({ id: 'core.scaleBy', category: 'game', shape: 'statement', label: 'block.scaleBy', args: [L, { id: 'percent', type: 'expr', default: lit(10) }],
    run: (ctx: ScriptContext, a) => {
      const s = scene(ctx);
      for (const k of ['scaleX', 'scaleY']) { const cur = n(s.getProp(a.layer, k) ?? 1); s.setProp(a.layer, k, cur + (Math.sign(cur) || 1) * n(a.percent) / 100); }
    } });
  B({ id: 'core.scaleTo', category: 'game', shape: 'statement', label: 'block.scaleTo', args: [L, { id: 'percent', type: 'expr', default: lit(150) }, { id: 'seconds', type: 'number', default: 0.5 }],
    async run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      const v = n(a.percent) / 100;
      await Promise.all(['scaleX', 'scaleY'].map((k) => s.tween(a.layer, k, (Math.sign(n(s.getProp(a.layer, k) ?? 1)) || 1) * v, a.seconds, 'easeInOut', ctx.token)));
    } });
  B({ id: 'core.changeOpacity', category: 'game', shape: 'statement', label: 'block.changeOpacity', args: [L, { id: 'delta', type: 'expr', default: lit(-0.1) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); s.setProp(a.layer, 'opacity', Math.max(0, Math.min(1, n(s.getProp(a.layer, 'opacity') ?? 1) + n(a.delta)))); } });
  B({ id: 'core.fadeIn', category: 'game', shape: 'statement', label: 'block.fadeIn', args: [L, { id: 'seconds', type: 'number', default: 0.5 }],
    async run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      if (!s.isVisible(a.layer)) s.setProp(a.layer, 'opacity', 0);
      s.setVisible(a.layer, true);
      await s.tween(a.layer, 'opacity', 1, a.seconds, 'easeOut', ctx.token);
    } });
  B({ id: 'core.fadeOut', category: 'game', shape: 'statement', label: 'block.fadeOut', args: [L, { id: 'seconds', type: 'number', default: 0.5 }],
    async run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      const before = n(s.getProp(a.layer, 'opacity') ?? 1) || 1;
      await s.tween(a.layer, 'opacity', 0, a.seconds, 'easeIn', ctx.token);
      if (ctx.cancelled) return;
      s.setVisible(a.layer, false);
      s.setProp(a.layer, 'opacity', before); // shown again later at its usual opacity
    } });
  B({ id: 'core.flip', category: 'game', shape: 'statement', label: 'block.flip', args: [L, { id: 'axis', type: 'select', default: 'x', options: [{ value: 'x', label: 'axis.horizontal' }, { value: 'y', label: 'axis.vertical' }] }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); const k = a.axis === 'y' ? 'scaleY' : 'scaleX'; s.setProp(a.layer, k, -n(s.getProp(a.layer, k) ?? 1)); } });
  B({ id: 'core.toFront', category: 'game', shape: 'statement', label: 'block.toFront', args: [L], run: (ctx: ScriptContext, a) => scene(ctx).reorder(a.layer, 'front') });
  B({ id: 'core.toBack', category: 'game', shape: 'statement', label: 'block.toBack', args: [L], run: (ctx: ScriptContext, a) => scene(ctx).reorder(a.layer, 'back') });
  B({ id: 'core.rotationOf', category: 'game', shape: 'reporter', label: 'block.rotationOf', args: [L], report: (ctx: ScriptContext, a) => n(ctx.scene?.getProp(a.layer, 'rotation')) });

  /* Page changes (inheritance) ---------------------------------------------- */
  const OPT_LAYER = { id: 'layer', type: 'layer' as const, layerTypes: ANY, optional: true };
  B({ id: LEAVE_REMOVE_BLOCK, category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.onLeaveRemove', args: [OPT_LAYER],
    run: (ctx: ScriptContext, a) => scene(ctx).leaveRule('remove', a.layer || null, ctx.stackId) });
  B({ id: LEAVE_PAUSE_BLOCK, category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.onLeavePause', args: [OPT_LAYER],
    run: (ctx: ScriptContext, a) => scene(ctx).leaveRule('pause', a.layer || null, ctx.stackId) });
  B({ id: 'core.pauseElement', category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.pauseElement', args: [{ id: 'layer', type: 'layer', layerTypes: ANY }],
    run: (ctx: ScriptContext, a) => scene(ctx).pauseElement(a.layer) });
  B({ id: 'core.resumeElement', category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.resumeElement', args: [OPT_LAYER],
    run: (ctx: ScriptContext, a) => scene(ctx).resumeElement(a.layer || null) });
  B({ id: 'core.isPaused', category: 'game', shape: 'boolean', layerTypes: ANY, label: 'block.isPaused', args: [{ id: 'layer', type: 'layer', layerTypes: ANY }],
    report: (ctx: ScriptContext, a) => { const s = ctx.scene; const l = s?.layer(a.layer); return !!l && s.pausedLayers.has(l.id); } });

  /* Element parameters --------------------------------------------------------- */
  const P = { id: 'param', type: 'param' as const, paramOf: 'layer' };
  const paramKey = (s: any, layer: string, param: unknown) => {
    const l = s.layer(layer);
    const p = findParam(l, param);
    if (!l || !p) throw new Error(`Element "${l?.name ?? layer}" has no parameter "${param}"`);
    return { key: `param.${p.id}`, def: p };
  };
  const coerceParam = (type: string, v: unknown) => (type === 'number' ? n(v) : type === 'boolean' ? truthy(v as any) : asText(v));
  B({ id: 'core.setParam', category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.setParam', args: [P, L, { id: 'value', type: 'expr', default: lit(0) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); const { key, def } = paramKey(s, a.layer, a.param); s.setProp(a.layer, key, coerceParam(def.type, a.value)); } });
  B({ id: 'core.changeParam', category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.changeParam', args: [P, L, { id: 'delta', type: 'expr', default: lit(1) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); const { key } = paramKey(s, a.layer, a.param); s.setProp(a.layer, key, n(s.getProp(a.layer, key)) + n(a.delta)); } });
  B({ id: 'core.paramOf', category: 'game', shape: 'reporter', layerTypes: ANY, label: 'block.paramOf', args: [P, L],
    report: (ctx: ScriptContext, a) => { const s = ctx.scene; if (!s) return 0; const { key } = paramKey(s, a.layer, a.param); return s.getProp(a.layer, key) ?? 0; } });

  /* Lists ------------------------------------------------------------------------ */
  const listOf = (ctx: ScriptContext, id: string) => toList(ctx.vars.get(id) ?? []);
  const setList = (ctx: ScriptContext, id: string, l: unknown[]) => { if (id) ctx.vars.set(id, l as any); };
  const idx = (len: number, v: unknown): number => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s === 'last') return len - 1;
    if (s === 'random') return Math.floor(Math.random() * len);
    return Math.floor(n(v)) - 1;
  };
  B({ id: 'core.listAdd', category: 'variables', shape: 'statement', label: 'block.listAdd', args: [{ id: 'value', type: 'expr', default: lit('thing') }, LIST],
    run: (ctx: ScriptContext, a) => { const l = listOf(ctx, a.variable); l.push(a.value as any); setList(ctx, a.variable, l); } });
  B({ id: 'core.listDelete', category: 'variables', shape: 'statement', label: 'block.listDelete', args: [{ id: 'index', type: 'expr', default: lit(1) }, LIST],
    run: (ctx: ScriptContext, a) => { const l = listOf(ctx, a.variable); const i = idx(l.length, a.index); if (i >= 0 && i < l.length) { l.splice(i, 1); setList(ctx, a.variable, l); } } });
  B({ id: 'core.listRemove', category: 'variables', shape: 'statement', label: 'block.listRemove', args: [{ id: 'value', type: 'expr', default: lit('thing') }, LIST],
    run: (ctx: ScriptContext, a) => { const l = listOf(ctx, a.variable); const i = l.findIndex((x) => String(x).toLowerCase() === asText(a.value).toLowerCase()); if (i >= 0) { l.splice(i, 1); setList(ctx, a.variable, l); } } });
  B({ id: 'core.listClear', category: 'variables', shape: 'statement', label: 'block.listClear', args: [LIST], run: (ctx: ScriptContext, a) => setList(ctx, a.variable, []) });
  B({ id: 'core.listInsert', category: 'variables', shape: 'statement', label: 'block.listInsert', args: [{ id: 'value', type: 'expr', default: lit('thing') }, { id: 'index', type: 'expr', default: lit(1) }, LIST],
    run: (ctx: ScriptContext, a) => { const l = listOf(ctx, a.variable); const i = Math.max(0, Math.min(l.length, idx(l.length + 1, a.index))); l.splice(i, 0, a.value as any); setList(ctx, a.variable, l); } });
  B({ id: 'core.listReplace', category: 'variables', shape: 'statement', label: 'block.listReplace', args: [{ id: 'index', type: 'expr', default: lit(1) }, LIST, { id: 'value', type: 'expr', default: lit('thing') }],
    run: (ctx: ScriptContext, a) => { const l = listOf(ctx, a.variable); const i = idx(l.length, a.index); if (i >= 0 && i < l.length) { l[i] = a.value as any; setList(ctx, a.variable, l); } } });
  B({ id: 'core.listItem', category: 'variables', shape: 'reporter', label: 'block.listItem', args: [{ id: 'index', type: 'expr', default: lit(1) }, LIST],
    report: (ctx: ScriptContext, a) => { const l = listOf(ctx, a.variable); return l[idx(l.length, a.index)] ?? ''; } });
  B({ id: 'core.listIndexOf', category: 'variables', shape: 'reporter', label: 'block.listIndexOf', args: [{ id: 'value', type: 'expr', default: lit('thing') }, LIST],
    report: (ctx: ScriptContext, a) => listOf(ctx, a.variable).findIndex((x) => String(x).toLowerCase() === asText(a.value).toLowerCase()) + 1 });
  B({ id: 'core.listLength', category: 'variables', shape: 'reporter', label: 'block.listLength', args: [LIST], report: (ctx: ScriptContext, a) => listOf(ctx, a.variable).length });
  B({ id: 'core.listContains', category: 'variables', shape: 'boolean', label: 'block.listContains', args: [LIST, { id: 'value', type: 'expr', default: lit('thing') }],
    report: (ctx: ScriptContext, a) => listOf(ctx, a.variable).some((x) => String(x).toLowerCase() === asText(a.value).toLowerCase()) });

  /* Labels: text and numbers shown at a position ---------------------------- */
  B({ id: 'core.showLabel', category: 'game', shape: 'statement', label: 'block.showLabel', args: [{ id: 'value', type: 'expr', default: lit('Hello') }, { id: 'x', type: 'expr', default: lit(40) }, { id: 'y', type: 'expr', default: lit(40) }, { id: 'name', type: 'string', default: 'label' }, { id: 'size', type: 'number', default: 36 }],
    run(ctx: ScriptContext, a, block) {
      const s = scene(ctx);
      const raw = block.args.value;
      // The label follows its value (a variable, a parameter, a calculation…) every frame.
      const value = () => asText(raw === undefined || raw === null ? a.value : ctx.evaluate(raw));
      s.showLabel(a.name || 'label', value, n(a.x), n(a.y), { fontSize: n(a.size) || 36 }, s.isGlobalScript(ctx.stackId));
    } });
  B({ id: 'core.showList', category: 'game', shape: 'statement', label: 'block.showList', args: [LIST, { id: 'x', type: 'expr', default: lit(40) }, { id: 'y', type: 'expr', default: lit(40) }, { id: 'name', type: 'string', default: 'list' }],
    run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      const id = a.variable;
      const value = () => toList(ctx.vars.get(id) ?? []).map((x, i) => `${i + 1}. ${asText(x)}`).join('\n');
      s.showLabel(a.name || 'list', value, n(a.x), n(a.y), { fontSize: 30 }, s.isGlobalScript(ctx.stackId));
    } });
  B({ id: 'core.hideLabel', category: 'game', shape: 'statement', label: 'block.hideLabel', args: [{ id: 'name', type: 'string', default: '', optional: true }],
    run: (ctx: ScriptContext, a) => scene(ctx).hideLabel(a.name ? String(a.name) : null) });

  /* Sprites (frame animation) ------------------------------------------------- */
  const SL = { id: 'layer', type: 'layer' as const, layerTypes: SPRITE };
  const frames = (s: any, layer: string) => spriteFrames(s.layerState.get(s.layer(layer)?.id) || {});
  B({ id: 'core.whenSpriteEnds', category: 'game', shape: 'hat', layerTypes: SPRITE, label: 'block.whenSpriteEnds', args: [SL], event: 'sprite.ended', context: 'scene', matches: (e, a) => e.layerId === a.layer });
  B({ id: 'core.spriteFrame', category: 'game', shape: 'statement', layerTypes: SPRITE, label: 'block.spriteFrame', args: [SL, { id: 'frame', type: 'expr', default: lit(1) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); s.setProp(a.layer, 'playing', false); s.setProp(a.layer, 'frame', Math.max(1, Math.floor(n(a.frame)))); } });
  B({ id: 'core.spritePlay', category: 'game', shape: 'statement', layerTypes: SPRITE, label: 'block.spritePlay', args: [SL, { id: 'fps', type: 'expr', default: lit(8) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); s.setProp(a.layer, 'fps', Math.max(0, n(a.fps))); s.setProp(a.layer, 'reverse', false); s.setProp(a.layer, 'playing', true); } });
  B({ id: 'core.spriteReverse', category: 'game', shape: 'statement', layerTypes: SPRITE, label: 'block.spriteReverse', args: [SL, { id: 'fps', type: 'expr', default: lit(8) }],
    run: (ctx: ScriptContext, a) => { const s = scene(ctx); s.setProp(a.layer, 'fps', Math.max(0, n(a.fps))); s.setProp(a.layer, 'reverse', true); s.setProp(a.layer, 'playing', true); } });
  B({ id: 'core.spritePlayWait', category: 'game', shape: 'statement', layerTypes: SPRITE, label: 'block.spritePlayWait', args: [SL, { id: 'fps', type: 'expr', default: lit(8) }],
    async run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      s.setProp(a.layer, 'fps', Math.max(0, n(a.fps))); s.setProp(a.layer, 'reverse', false); s.setProp(a.layer, 'loop', false);
      s.setProp(a.layer, 'frame', 1); s.setProp(a.layer, 'playing', true);
      await ctx.waitUntil(() => !s.getProp(a.layer, 'playing'));
    } });
  B({ id: 'core.spriteStop', category: 'game', shape: 'statement', layerTypes: SPRITE, label: 'block.spriteStop', args: [SL], run: (ctx: ScriptContext, a) => scene(ctx).setProp(a.layer, 'playing', false) });
  B({ id: 'core.spriteAddFrame', category: 'game', shape: 'statement', layerTypes: SPRITE, label: 'block.spriteAddFrame', args: [{ id: 'media', type: 'layer', layerTypes: IMAGES }, SL, { id: 'index', type: 'expr', default: null, optional: true }],
    run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      const src = s.layer(a.media);
      if (!src) throw new Error(`Element "${a.media}" is not on this page`);
      const st = s.layerState.get(src.id) || {};
      const assetId = src.type === 'core.sprite' ? spriteFrames(st)[Math.max(0, Math.floor(n(st.frame)) - 1)]?.assetId ?? null : st.assetId ?? null;
      const list = [...frames(s, a.layer)];
      const empty = a.index === null || a.index === undefined || a.index === '';
      const at = empty ? list.length : Math.max(0, Math.min(list.length, Math.floor(n(a.index)) - 1));
      list.splice(at, 0, { assetId });
      s.setProp(a.layer, 'frames', list);
    } });
  B({ id: 'core.spriteCurrent', category: 'game', shape: 'reporter', layerTypes: SPRITE, label: 'block.spriteCurrent', args: [SL], report: (ctx: ScriptContext, a) => Math.floor(n(ctx.scene?.getProp(a.layer, 'frame'))) || 1 });
  B({ id: 'core.spriteCount', category: 'game', shape: 'reporter', layerTypes: SPRITE, label: 'block.spriteCount', args: [SL], report: (ctx: ScriptContext, a) => (ctx.scene ? frames(ctx.scene, a.layer).length : 0) });

  /* Free dialogue ------------------------------------------------------------- */
  const FD = { id: 'layer', type: 'layer' as const, layerTypes: ['core.freeDialogue'] };
  B({ id: 'core.freeSay', category: 'looks', shape: 'statement', layerTypes: ['core.freeDialogue'], label: 'block.freeSay', args: [FD, { id: 'text', type: 'expr', default: lit('Hello!') }, { id: 'speaker', type: 'string', default: '', optional: true }, { id: 'wait', type: 'boolean', default: true }],
    async run(ctx: ScriptContext, a) {
      const s = scene(ctx);
      if (a.speaker) s.setProp(a.layer, 'speaker', String(a.speaker));
      s.setProp(a.layer, 'text', asText(a.text));
      s.setVisible(a.layer, true);
      // With a typing speed the element types the text itself; otherwise it appears at once.
      if (num(s.getProp(a.layer, 'typeSpeed')) > 0) { s.setProp(a.layer, 'reveal', 0); if (a.wait) await ctx.waitUntil(() => n(s.getProp(a.layer, 'reveal')) >= 1); }
      else s.setProp(a.layer, 'reveal', 1);
    } });
  B({ id: 'core.whenDialogueTyped', category: 'events', shape: 'hat', layerTypes: ['core.freeDialogue'], label: 'block.whenDialogueTyped', args: [FD], event: 'dialogue.typed', context: 'scene', matches: (e, a) => e.layerId === a.layer });

  /* Collectibles ----------------------------------------------------------------- */
  const items = (ctx: ScriptContext) => {
    const it = ctx.runtime?.items;
    if (!it) throw new Error('Collectibles need a playing game');
    return it;
  };
  const OPT_ITEM = { ...ITEM, optional: true };
  B({ id: 'core.whenItemCollected', category: 'game', shape: 'hat', label: 'block.whenItemCollected', args: [OPT_ITEM], event: 'item.collected', context: 'scene', matches: (e, a) => sameItem(a.item, e) });
  B({ id: 'core.whenItemUsed', category: 'game', shape: 'hat', layerTypes: ANY, label: 'block.whenItemUsed', args: [OPT_ITEM, { id: 'layer', type: 'layer', layerTypes: ANY }], event: 'item.used', context: 'scene',
    matches: (e, a) => sameItem(a.item, e) && (!a.layer || e.layerId === a.layer) });
  B({ id: 'core.whenItemSelected', category: 'game', shape: 'hat', label: 'block.whenItemSelected', args: [OPT_ITEM], event: 'item.selected', context: 'scene', matches: (e, a) => !!e.item && sameItem(a.item, e) });
  B({ id: 'core.collectItem', category: 'game', shape: 'statement', label: 'block.collectItem', args: [{ id: 'amount', type: 'expr', default: lit(1) }, ITEM],
    run: (ctx: ScriptContext, a) => items(ctx).add(a.item, n(a.amount) || 1) });
  B({ id: 'core.pickUp', category: 'game', shape: 'statement', layerTypes: ANY, label: 'block.pickUp', args: [L, OPT_ITEM],
    run: (ctx: ScriptContext, a) => scene(ctx).pickUp(a.layer, a.item ? (findItem(ctx.project, a.item)?.name ?? String(a.item)) : null) });
  B({ id: 'core.removeItem', category: 'game', shape: 'statement', label: 'block.removeItem', args: [{ id: 'amount', type: 'expr', default: lit(1) }, ITEM],
    run: (ctx: ScriptContext, a) => items(ctx).remove(a.item, false, n(a.amount) || 1) });
  B({ id: 'core.removeAllItems', category: 'game', shape: 'statement', label: 'block.removeAllItems', args: [ITEM], run: (ctx: ScriptContext, a) => items(ctx).remove(a.item, true) });
  B({ id: 'core.selectItem', category: 'game', shape: 'statement', label: 'block.selectItem', args: [OPT_ITEM], run: (ctx: ScriptContext, a) => items(ctx).select(a.item || null) });
  B({ id: 'core.hasItem', category: 'game', shape: 'boolean', label: 'block.hasItem', args: [ITEM], report: (ctx: ScriptContext, a) => !!ctx.runtime?.items?.has(a.item) });
  B({ id: 'core.itemCount', category: 'game', shape: 'reporter', label: 'block.itemCount', args: [ITEM], report: (ctx: ScriptContext, a) => ctx.runtime?.items?.count(a.item) ?? 0 });
  B({ id: 'core.selectedItem', category: 'game', shape: 'reporter', label: 'block.selectedItem', args: [], report: (ctx: ScriptContext) => ctx.runtime?.items?.selected ?? '' });
  B({ id: 'core.itemSelectedIs', category: 'game', shape: 'boolean', label: 'block.itemSelectedIs', args: [ITEM],
    report: (ctx: ScriptContext, a) => { const sel = ctx.runtime?.items?.selected; return !!sel && sameItem(a.item, { item: sel, itemId: findItem(ctx.project, sel)?.id ?? null }); } });
  B({ id: 'core.inventoryCount', category: 'game', shape: 'reporter', label: 'block.inventoryCount', args: [], report: (ctx: ScriptContext) => ctx.runtime?.items?.list().length ?? 0 });
}
