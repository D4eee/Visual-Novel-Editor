import type { BlockDef, Engine } from '@vne/core';
import { truthy } from '@vne/core';
import type { ScriptContext } from '../script';
import { StopThread } from '../script';

const KEYS = ['Space', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((k) => `Key${k}`), ...'0123456789'.split('').map((d) => `Digit${d}`)];
/** Element types that blocks are offered for (see BlockDef.layerTypes). '*' = every element, also audio. */
const MEDIA = ['core.audio', 'core.video'];
const TEXTY = ['core.text', 'core.button', 'core.freeDialogue'];
const ANY = ['*'];
const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'bounce', 'elastic'];

function needScene(ctx: ScriptContext): any {
  const s = ctx.scene;
  if (!s) throw new Error('This block needs a playing scene');
  return s;
}

export function registerBuiltinBlocks(engine: Engine): void {
  const B = (def: BlockDef) => engine.blocks.register(def, 'core');

  /* Events ------------------------------------------------------------------- */
  B({ id: 'core.whenSceneStarts', category: 'events', shape: 'hat', label: 'block.whenSceneStarts', args: [], event: 'scene.enter', context: 'scene' });
  B({ id: 'core.whenSceneEnds', category: 'events', shape: 'hat', label: 'block.whenSceneEnds', args: [], event: 'scene.exit', context: 'scene' });
  B({ id: 'core.whenLayerClicked', category: 'events', shape: 'hat', label: 'block.whenLayerClicked', args: [{ id: 'layer', type: 'layer' }], event: 'layer.click', context: 'scene', matches: (e, a) => e.layerId === a.layer });
  B({ id: 'core.whenHoverStart', category: 'events', shape: 'hat', label: 'block.whenHoverStart', args: [{ id: 'layer', type: 'layer' }], event: 'layer.hoverEnter', context: 'scene', matches: (e, a) => e.layerId === a.layer });
  B({ id: 'core.whenHoverEnd', category: 'events', shape: 'hat', label: 'block.whenHoverEnd', args: [{ id: 'layer', type: 'layer' }], event: 'layer.hoverLeave', context: 'scene', matches: (e, a) => e.layerId === a.layer });
  B({ id: 'core.whenKeyPressed', category: 'events', shape: 'hat', label: 'block.whenKeyPressed', args: [{ id: 'key', type: 'key', default: 'Space', options: KEYS.map((k) => ({ value: k, label: k.replace(/^Key|^Digit/, '') })) }], event: 'key.down', context: 'scene', matches: (e, a) => e.code === a.key });
  B({ id: 'core.whenAnimationFinished', category: 'events', shape: 'hat', label: 'block.whenAnimationFinished', args: [{ id: 'anim', type: 'animation' }], event: 'anim.finished', context: 'scene', matches: (e, a) => e.animId === a.anim });
  B({ id: 'core.whenMediaEnded', category: 'events', shape: 'hat', layerTypes: MEDIA, label: 'block.whenMediaEnded', args: [{ id: 'layer', type: 'layer' }], event: 'media.ended', context: 'scene', matches: (e, a) => e.layerId === a.layer });
  B({ id: 'core.whenVariableChanges', category: 'events', shape: 'hat', label: 'block.whenVariableChanges', args: [{ id: 'variable', type: 'variable' }], event: 'var.changed', context: 'scene', matches: (e, a) => e.varId === a.variable });
  B({ id: 'core.whenLineShown', category: 'events', shape: 'hat', label: 'block.whenLineShown', args: [{ id: 'line', type: 'line' }], event: 'dialogue.line', context: 'scene', matches: (e, a) => e.lineId === a.line });
  B({ id: 'core.whenDialogueEnds', category: 'events', shape: 'hat', label: 'block.whenDialogueEnds', args: [], event: 'dialogue.end', context: 'scene' });
  B({ id: 'core.whenChoiceSelected', category: 'events', shape: 'hat', label: 'block.whenChoiceSelected', args: [{ id: 'choice', type: 'choice' }], event: 'choice.selected', context: 'scene', matches: (e, a) => e.choiceId === a.choice });
  B({ id: 'core.whenMessage', category: 'events', shape: 'hat', label: 'block.whenMessage', args: [{ id: 'message', type: 'message', default: 'go' }], event: 'message', context: 'scene', matches: (e, a) => String(e.name) === String(a.message) });
  B({ id: 'core.afterSeconds', category: 'events', shape: 'hat', label: 'block.afterSeconds', args: [{ id: 'seconds', type: 'number', default: 2 }], context: 'scene',
    setup(ctx: ScriptContext, a, fire) {
      let cancelled = false;
      ctx.host.sleep(Number(a.seconds) || 0, ctx.token).then(() => { if (!cancelled) fire(); }).catch(() => {});
      return () => { cancelled = true; ctx.token.cancel(); };
    } });
  B({ id: 'core.everySeconds', category: 'events', shape: 'hat', label: 'block.everySeconds', args: [{ id: 'seconds', type: 'number', default: 1 }], context: 'scene',
    setup(ctx: ScriptContext, a, fire) {
      const period = Math.max(0.05, Number(a.seconds) || 1);
      const loop = async () => {
        while (!ctx.token.cancelled) {
          await ctx.host.sleep(period, ctx.token);
          if (!ctx.token.cancelled) fire();
        }
      };
      loop().catch(() => {});
      return () => ctx.token.cancel();
    } });

  /* Control ------------------------------------------------------------------ */
  B({ id: 'core.wait', category: 'control', shape: 'statement', label: 'block.wait', args: [{ id: 'seconds', type: 'number', default: 1 }], run: (ctx: ScriptContext, a) => ctx.wait(a.seconds) });
  B({ id: 'core.waitUntil', category: 'control', shape: 'statement', label: 'block.waitUntil', args: [{ id: 'cond', type: 'expr', default: { k: 'lit', v: true } }],
    run: (ctx: ScriptContext, _a, b) => ctx.waitUntil(() => truthy(ctx.evaluate(b.args.cond ?? true))) });
  B({ id: 'core.if', category: 'control', shape: 'c', label: 'block.if', args: [{ id: 'cond', type: 'expr', default: { k: 'lit', v: true } }],
    async run(ctx: ScriptContext, a, b) { if (truthy(a.cond)) await ctx.runBody(b.body); } });
  B({ id: 'core.ifElse', category: 'control', shape: 'c-else', label: 'block.ifElse', args: [{ id: 'cond', type: 'expr', default: { k: 'lit', v: true } }],
    async run(ctx: ScriptContext, a, b) { await ctx.runBody(truthy(a.cond) ? b.body : b.else); } });
  B({ id: 'core.repeat', category: 'control', shape: 'c', label: 'block.repeat', args: [{ id: 'times', type: 'number', default: 3 }],
    async run(ctx: ScriptContext, a, b) {
      const n = Math.max(0, Math.min(100000, Math.floor(a.times)));
      for (let i = 0; i < n; i++) { await ctx.runBody(b.body); await ctx.host.nextFrame(ctx.token); }
    } });
  B({ id: 'core.repeatUntil', category: 'control', shape: 'c', label: 'block.repeatUntil', args: [{ id: 'cond', type: 'expr', default: { k: 'lit', v: false } }],
    async run(ctx: ScriptContext, _a, b) {
      while (!truthy(ctx.evaluate(b.args.cond ?? false))) { await ctx.runBody(b.body); await ctx.host.nextFrame(ctx.token); }
    } });
  B({ id: 'core.forever', category: 'control', shape: 'c', label: 'block.forever', args: [], endsScript: true,
    async run(ctx: ScriptContext, _a, b) { for (;;) { await ctx.runBody(b.body); await ctx.host.nextFrame(ctx.token); } } });
  B({ id: 'core.stop', category: 'control', shape: 'cap', label: 'block.stop', args: [], run: () => { throw new StopThread(); } });
  B({ id: 'core.broadcast', category: 'control', shape: 'statement', label: 'block.broadcast', args: [{ id: 'message', type: 'message', default: 'go' }],
    run: (ctx: ScriptContext, a) => { ctx.emit({ type: 'message', name: String(a.message) }); } });
  B({ id: 'core.runBehavior', category: 'control', shape: 'statement', label: 'block.runBehavior', args: [{ id: 'behavior', type: 'behavior' }],
    async run(ctx: ScriptContext, a) {
      const beh = ctx.project.behaviors.find((x) => x.id === a.behavior);
      if (!beh) throw new Error('Behavior not found');
      await ctx.runBody(beh.body);
    } });
  B({ id: 'core.log', category: 'control', shape: 'statement', label: 'block.log', args: [{ id: 'value', type: 'expr', default: { k: 'lit', v: 'Hello' } }],
    run: (ctx: ScriptContext, a) => { ctx.runtime?.debugLog?.(String(a.value)); } });

  /* Looks -------------------------------------------------------------------- */
  // Element blocks: drop any element into the slot. "Start" shows it, plays its media and every animation that moves it.
  const clipsOf = (scene: any, layerId: string): string[] => {
    const id = scene.layer(layerId)?.id;
    return (scene.clips || scene.data.animations || []).filter((c: any) => c.tracks.some((tr: any) => tr.layerId === id) || c.media.some((m: any) => m.layerId === id)).map((c: any) => c.id);
  };
  B({ id: 'core.startElement', category: 'elements', shape: 'statement', layerTypes: ANY, label: 'block.startElement', args: [{ id: 'layer', type: 'layer' }, { id: 'wait', type: 'boolean', default: false }],
    async run(ctx: ScriptContext, a) {
      const s = needScene(ctx);
      const l = s.layer(a.layer);
      if (!l) throw new Error(`Element "${a.layer}" is not in this scene`);
      s.setVisible(l.id, true);
      if (l.type === 'core.audio' || l.type === 'core.video') s.media(l.id, 'play');
      const runs = clipsOf(s, l.id).map((id) => s.playAnimation(id));
      if (a.wait) await Promise.all(runs);
    } });
  B({ id: 'core.stopElement', category: 'elements', shape: 'statement', layerTypes: ANY, label: 'block.stopElement', args: [{ id: 'layer', type: 'layer' }],
    run(ctx: ScriptContext, a) {
      const s = needScene(ctx);
      const l = s.layer(a.layer);
      if (!l) return;
      if (l.type === 'core.audio' || l.type === 'core.video') s.media(l.id, 'stop');
      for (const id of clipsOf(s, l.id)) s.stopAnimation(id);
    } });
  B({ id: 'core.show', category: 'looks', shape: 'statement', label: 'block.show', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).setVisible(a.layer, true) });
  B({ id: 'core.hide', category: 'looks', shape: 'statement', label: 'block.hide', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).setVisible(a.layer, false) });
  B({ id: 'core.setProp', category: 'looks', shape: 'statement', label: 'block.setProp', args: [{ id: 'layer', type: 'layer' }, { id: 'prop', type: 'prop', default: 'opacity' }, { id: 'value', type: 'expr', default: { k: 'lit', v: 1 } }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, a.prop, a.value) });
  B({ id: 'core.changeProp', category: 'looks', shape: 'statement', label: 'block.changeProp', args: [{ id: 'layer', type: 'layer' }, { id: 'prop', type: 'prop', default: 'x' }, { id: 'delta', type: 'number', default: 10 }],
    run: (ctx: ScriptContext, a) => { const s = needScene(ctx); s.setProp(a.layer, a.prop, (Number(s.getProp(a.layer, a.prop)) || 0) + Number(a.delta)); } });
  B({ id: 'core.tweenProp', category: 'looks', shape: 'statement', label: 'block.tweenProp',
    args: [{ id: 'layer', type: 'layer' }, { id: 'prop', type: 'prop', default: 'x' }, { id: 'value', type: 'expr', default: { k: 'lit', v: 640 } }, { id: 'seconds', type: 'number', default: 1 }, { id: 'ease', type: 'ease', default: 'easeInOut', options: EASES.map((e) => ({ value: e, label: `ease.${e === 'easeIn' ? 'in' : e === 'easeOut' ? 'out' : e === 'easeInOut' ? 'inOut' : e}` })) }, { id: 'wait', type: 'boolean', default: true }],
    async run(ctx: ScriptContext, a) {
      const p = needScene(ctx).tween(a.layer, a.prop, a.value, a.seconds, a.ease, ctx.token);
      if (a.wait) await p;
    } });
  B({ id: 'core.playAnimation', category: 'looks', shape: 'statement', label: 'block.playAnimation', args: [{ id: 'anim', type: 'animation' }, { id: 'wait', type: 'boolean', default: false }],
    async run(ctx: ScriptContext, a) {
      const p = needScene(ctx).playAnimation(a.anim);
      if (a.wait) await Promise.race([p, new Promise<void>((res) => ctx.token.onCancel(res))]);
    } });
  B({ id: 'core.stopAnimation', category: 'looks', shape: 'statement', label: 'block.stopAnimation', args: [{ id: 'anim', type: 'animation' }], run: (ctx: ScriptContext, a) => needScene(ctx).stopAnimation(a.anim) });
  B({ id: 'core.setText', category: 'looks', shape: 'statement', layerTypes: TEXTY, label: 'block.setText', args: [{ id: 'layer', type: 'layer' }, { id: 'text', type: 'expr', default: { k: 'lit', v: 'Hello' } }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'text', String(a.text)) });
  B({ id: 'core.setImage', category: 'looks', shape: 'statement', layerTypes: ['core.image', 'core.background', 'core.button'], label: 'block.setImage', args: [{ id: 'layer', type: 'layer' }, { id: 'asset', type: 'asset', assetKind: 'image' }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'assetId', a.asset) });
  B({ id: 'core.setPortrait', category: 'looks', shape: 'statement', layerTypes: ['core.character'], label: 'block.setPortrait', args: [{ id: 'layer', type: 'layer' }, { id: 'portrait', type: 'portrait', default: null }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'portraitId', a.portrait) });
  B({ id: 'core.shakeScreen', category: 'looks', shape: 'statement', label: 'block.shakeScreen', args: [{ id: 'intensity', type: 'number', default: 12 }, { id: 'seconds', type: 'number', default: 0.5 }],
    async run(ctx: ScriptContext, a) { await needScene(ctx).shake(Number(a.intensity), Number(a.seconds), ctx.token); } });
  B({ id: 'core.flashScreen', category: 'looks', shape: 'statement', label: 'block.flashScreen', args: [{ id: 'color', type: 'string', default: '#ffffff' }, { id: 'seconds', type: 'number', default: 0.4 }],
    async run(ctx: ScriptContext, a) { await needScene(ctx).flash(String(a.color || '#fff'), Number(a.seconds), ctx.token); } });

  /* Sound -------------------------------------------------------------------- */
  B({ id: 'core.playMedia', category: 'sound', shape: 'statement', layerTypes: MEDIA, label: 'block.playMedia', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).media(a.layer, 'play') });
  B({ id: 'core.pauseMedia', category: 'sound', shape: 'statement', layerTypes: MEDIA, label: 'block.pauseMedia', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).media(a.layer, 'pause') });
  B({ id: 'core.stopMedia', category: 'sound', shape: 'statement', layerTypes: MEDIA, label: 'block.stopMedia', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).media(a.layer, 'stop') });
  B({ id: 'core.playSound', category: 'sound', shape: 'statement', label: 'block.playSound', args: [{ id: 'asset', type: 'asset', assetKind: 'audio' }, { id: 'volume', type: 'number', default: 1 }],
    run: (ctx: ScriptContext, a) => { ctx.runtime.audio.playSound(a.asset, Number(a.volume)); } });
  B({ id: 'core.playMusic', category: 'sound', shape: 'statement', label: 'block.playMusic', args: [{ id: 'asset', type: 'asset', assetKind: 'audio' }, { id: 'volume', type: 'number', default: 1 }],
    run: (ctx: ScriptContext, a) => { ctx.runtime.audio.playMusic(a.asset, Number(a.volume)); } });
  B({ id: 'core.stopMusic', category: 'sound', shape: 'statement', label: 'block.stopMusic', args: [], run: (ctx: ScriptContext) => { ctx.runtime.audio.stopMusic(); } });

  /* Variables ---------------------------------------------------------------- */
  B({ id: 'core.setVar', category: 'variables', shape: 'statement', label: 'block.setVar', args: [{ id: 'variable', type: 'variable' }, { id: 'value', type: 'expr', default: { k: 'lit', v: 0 } }],
    run: (ctx: ScriptContext, a) => { if (a.variable) ctx.vars.set(a.variable, a.value); } });
  B({ id: 'core.changeVar', category: 'variables', shape: 'statement', label: 'block.changeVar', args: [{ id: 'variable', type: 'variable' }, { id: 'delta', type: 'number', default: 1 }],
    run: (ctx: ScriptContext, a) => { if (a.variable) ctx.vars.set(a.variable, (Number(ctx.vars.get(a.variable)) || 0) + Number(a.delta)); } });
  B({ id: 'core.toggleVar', category: 'variables', shape: 'statement', label: 'block.toggleVar', args: [{ id: 'variable', type: 'variable' }],
    run: (ctx: ScriptContext, a) => { if (a.variable) ctx.vars.set(a.variable, !truthy(ctx.vars.get(a.variable))); } });

  /* Elements: position, size, appearance ------------------------------------- */
  const n = (v: any) => Number(v) || 0;
  B({ id: 'core.moveTo', category: 'looks', shape: 'statement', label: 'block.moveTo', args: [{ id: 'layer', type: 'layer' }, { id: 'x', type: 'expr', default: { k: 'lit', v: 640 } }, { id: 'y', type: 'expr', default: { k: 'lit', v: 360 } }],
    run: (ctx: ScriptContext, a) => { const s = needScene(ctx); s.setProp(a.layer, 'x', n(a.x)); s.setProp(a.layer, 'y', n(a.y)); } });
  B({ id: 'core.glideTo', category: 'looks', shape: 'statement', label: 'block.glideTo', args: [{ id: 'layer', type: 'layer' }, { id: 'x', type: 'expr', default: { k: 'lit', v: 640 } }, { id: 'y', type: 'expr', default: { k: 'lit', v: 360 } }, { id: 'seconds', type: 'number', default: 1 }],
    async run(ctx: ScriptContext, a) {
      const s = needScene(ctx);
      await Promise.all([s.tween(a.layer, 'x', n(a.x), a.seconds, 'easeInOut', ctx.token), s.tween(a.layer, 'y', n(a.y), a.seconds, 'easeInOut', ctx.token)]);
    } });
  B({ id: 'core.setSize', category: 'looks', shape: 'statement', label: 'block.setSize', args: [{ id: 'layer', type: 'layer' }, { id: 'percent', type: 'expr', default: { k: 'lit', v: 100 } }],
    run: (ctx: ScriptContext, a) => { const s = needScene(ctx); s.setProp(a.layer, 'scaleX', n(a.percent) / 100); s.setProp(a.layer, 'scaleY', n(a.percent) / 100); } });
  B({ id: 'core.setOpacity', category: 'looks', shape: 'statement', label: 'block.setOpacity', args: [{ id: 'layer', type: 'layer' }, { id: 'value', type: 'expr', default: { k: 'lit', v: 1 } }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'opacity', Math.max(0, Math.min(1, n(a.value)))) });

  /* Sensing (reporters and conditions) ------------------------------------------ */
  const sceneOr = (ctx: ScriptContext) => ctx.scene as any | null;
  const input = (ctx: ScriptContext) => ctx.runtime?.input || { x: 0, y: 0, down: false, keys: new Set<string>() };
  B({ id: 'core.mouseInside', category: 'sensing', shape: 'boolean', label: 'block.mouseInside', layerTypes: ['*'], args: [{ id: 'layer', type: 'layer' }],
    report: (ctx: ScriptContext, a) => !!sceneOr(ctx)?.contains(a.layer) });
  B({ id: 'core.touching', category: 'sensing', shape: 'boolean', label: 'block.touching', args: [{ id: 'layer', type: 'layer' }, { id: 'other', type: 'layer' }],
    report: (ctx: ScriptContext, a) => !!sceneOr(ctx)?.touching(a.layer, a.other) });
  B({ id: 'core.isVisible', category: 'sensing', shape: 'boolean', label: 'block.isVisible', args: [{ id: 'layer', type: 'layer' }],
    report: (ctx: ScriptContext, a) => !!sceneOr(ctx)?.isVisible(a.layer) });
  B({ id: 'core.propOf', category: 'sensing', shape: 'reporter', label: 'block.propOf', layerTypes: ['*'], args: [{ id: 'prop', type: 'prop', default: 'x' }, { id: 'layer', type: 'layer' }],
    report: (ctx: ScriptContext, a) => { const s = sceneOr(ctx); if (!s) return 0; if (a.prop === 'visible') return s.isVisible(a.layer); const v = s.getProp(a.layer, a.prop); return v ?? 0; } });
  B({ id: 'core.mouseX', category: 'sensing', shape: 'reporter', label: 'block.mouseX', args: [], report: (ctx: ScriptContext) => Math.round(input(ctx).x) });
  B({ id: 'core.mouseY', category: 'sensing', shape: 'reporter', label: 'block.mouseY', args: [], report: (ctx: ScriptContext) => Math.round(input(ctx).y) });
  B({ id: 'core.mouseDown', category: 'sensing', shape: 'boolean', label: 'block.mouseDown', args: [], report: (ctx: ScriptContext) => !!input(ctx).down });
  B({ id: 'core.keyPressed', category: 'sensing', shape: 'boolean', label: 'block.keyPressed', args: [{ id: 'key', type: 'key', default: 'Space', options: KEYS.map((k) => ({ value: k, label: k.replace(/^Key|^Digit/, '') })) }],
    report: (ctx: ScriptContext, a) => input(ctx).keys.has(String(a.key)) });
  B({ id: 'core.timer', category: 'sensing', shape: 'reporter', label: 'block.timer', args: [], report: (ctx: ScriptContext) => Math.round((sceneOr(ctx)?.timer || 0) * 100) / 100 });
  B({ id: 'core.resetTimer', category: 'sensing', shape: 'statement', label: 'block.resetTimer', args: [], context: 'scene', run: (ctx: ScriptContext) => sceneOr(ctx)?.resetTimer() });
  B({ id: 'core.whenMouseInside', category: 'events', shape: 'hat', label: 'block.whenMouseInside', layerTypes: ['*'], args: [{ id: 'layer', type: 'layer' }], context: 'scene',
    // Polls every frame: fires once each time the mouse moves into the element (any element, hidden ones excluded).
    setup(ctx: ScriptContext, a, fire) {
      let was = false;
      const loop = async () => {
        while (!ctx.token.cancelled) {
          const now = !!ctx.scene?.contains(a.layer);
          if (now && !was) fire();
          was = now;
          await ctx.host.nextFrame(ctx.token);
        }
      };
      loop().catch(() => {});
      return () => ctx.token.cancel();
    } });

  /* Operators ------------------------------------------------------------------ */
  const num2 = (op: string, label: string, f: (x: number, y: number) => number) =>
    B({ id: `core.${op}`, category: 'operators', shape: 'reporter', label, args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: 0 } }, { id: 'b', type: 'expr', default: { k: 'lit', v: 0 } }], report: (_c, a) => f(n(a.a), n(a.b)) });
  num2('add', 'block.add', (x, y) => x + y);
  num2('subtract', 'block.subtract', (x, y) => x - y);
  num2('multiply', 'block.multiply', (x, y) => x * y);
  num2('divide', 'block.divide', (x, y) => (y === 0 ? 0 : x / y));
  num2('mod', 'block.mod', (x, y) => (y === 0 ? 0 : ((x % y) + y) % y));
  B({ id: 'core.random', category: 'operators', shape: 'reporter', label: 'block.random', args: [{ id: 'from', type: 'expr', default: { k: 'lit', v: 1 } }, { id: 'to', type: 'expr', default: { k: 'lit', v: 10 } }],
    report: (_c, a) => {
      const lo = Math.min(n(a.from), n(a.to)), hi = Math.max(n(a.from), n(a.to));
      return Number.isInteger(lo) && Number.isInteger(hi) ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo);
    } });
  const cmp = (op: string, label: string, f: (x: any, y: any) => boolean) =>
    B({ id: `core.${op}`, category: 'operators', shape: 'boolean', label, args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: 0 } }, { id: 'b', type: 'expr', default: { k: 'lit', v: 0 } }], report: (_c, a) => f(a.a, a.b) });
  const same = (x: any, y: any) => (typeof x === 'number' || typeof y === 'number') && x !== '' && y !== '' && !isNaN(Number(x)) && !isNaN(Number(y)) ? Number(x) === Number(y) : String(x ?? '').toLowerCase() === String(y ?? '').toLowerCase();
  cmp('greater', 'block.greater', (x, y) => n(x) > n(y));
  cmp('less', 'block.less', (x, y) => n(x) < n(y));
  cmp('equals', 'block.equals', same);
  B({ id: 'core.and', category: 'operators', shape: 'boolean', label: 'block.and', args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: true } }, { id: 'b', type: 'expr', default: { k: 'lit', v: true } }], report: (_c, a) => truthy(a.a) && truthy(a.b) });
  B({ id: 'core.or', category: 'operators', shape: 'boolean', label: 'block.or', args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: false } }, { id: 'b', type: 'expr', default: { k: 'lit', v: false } }], report: (_c, a) => truthy(a.a) || truthy(a.b) });
  B({ id: 'core.not', category: 'operators', shape: 'boolean', label: 'block.not', args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: false } }], report: (_c, a) => !truthy(a.a) });
  B({ id: 'core.join', category: 'operators', shape: 'reporter', label: 'block.join', args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: 'Hello ' } }, { id: 'b', type: 'expr', default: { k: 'lit', v: 'world' } }], report: (_c, a) => `${a.a ?? ''}${a.b ?? ''}` });
  B({ id: 'core.letterOf', category: 'operators', shape: 'reporter', label: 'block.letterOf', args: [{ id: 'i', type: 'expr', default: { k: 'lit', v: 1 } }, { id: 's', type: 'expr', default: { k: 'lit', v: 'apple' } }], report: (_c, a) => [...String(a.s ?? '')][Math.floor(n(a.i)) - 1] ?? '' });
  B({ id: 'core.lengthOf', category: 'operators', shape: 'reporter', label: 'block.lengthOf', args: [{ id: 's', type: 'expr', default: { k: 'lit', v: 'apple' } }], report: (_c, a) => [...String(a.s ?? '')].length });
  B({ id: 'core.contains', category: 'operators', shape: 'boolean', label: 'block.contains', args: [{ id: 's', type: 'expr', default: { k: 'lit', v: 'apple' } }, { id: 't', type: 'expr', default: { k: 'lit', v: 'a' } }], report: (_c, a) => String(a.s ?? '').toLowerCase().includes(String(a.t ?? '').toLowerCase()) });
  B({ id: 'core.round', category: 'operators', shape: 'reporter', label: 'block.round', args: [{ id: 'a', type: 'expr', default: { k: 'lit', v: 1.5 } }], report: (_c, a) => Math.round(n(a.a)) });
  const FNS: Record<string, (x: number) => number> = { abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sqrt: (x) => Math.sqrt(Math.max(0, x)), sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180), ln: (x) => (x > 0 ? Math.log(x) : 0), log: (x) => (x > 0 ? Math.log10(x) : 0), exp: Math.exp };
  B({ id: 'core.mathOf', category: 'operators', shape: 'reporter', label: 'block.mathOf', args: [{ id: 'fn', type: 'select', default: 'abs', options: Object.keys(FNS).map((k) => ({ value: k, label: `fn.${k}` })) }, { id: 'a', type: 'expr', default: { k: 'lit', v: 0 } }],
    report: (_c, a) => (FNS[String(a.fn)] || FNS.abs)(n(a.a)) });

  /* Variables: value of a variable --------------------------------------------- */
  B({ id: 'core.varValue', category: 'variables', shape: 'reporter', label: 'block.varValue', args: [{ id: 'variable', type: 'variable' }],
    report: (ctx: ScriptContext, a) => (a.variable ? ctx.vars.get(a.variable) ?? 0 : 0) });

  /* Story -------------------------------------------------------------------- */
  B({ id: 'core.showChoice', category: 'story', shape: 'statement', label: 'block.showChoice', args: [{ id: 'choice', type: 'choice' }], context: 'scene', run: (ctx: ScriptContext, a) => needScene(ctx).setChoiceVisible(a.choice, true) });
  B({ id: 'core.hideChoice', category: 'story', shape: 'statement', label: 'block.hideChoice', args: [{ id: 'choice', type: 'choice' }], context: 'scene', run: (ctx: ScriptContext, a) => needScene(ctx).setChoiceVisible(a.choice, false) });
  B({ id: 'core.gotoLine', category: 'story', shape: 'statement', label: 'block.gotoLine', args: [{ id: 'line', type: 'line' }], context: 'scene', run: (ctx: ScriptContext, a) => needScene(ctx).gotoLine(a.line) });
  B({ id: 'core.advance', category: 'story', shape: 'statement', label: 'block.advance', args: [], context: 'scene', run: (ctx: ScriptContext) => needScene(ctx).advance() });
  B({ id: 'core.textbox', category: 'story', shape: 'statement', label: 'block.textbox', args: [{ id: 'visible', type: 'boolean', default: true }], context: 'scene', run: (ctx: ScriptContext, a) => needScene(ctx).setTextboxVisible(!!a.visible) });
  B({ id: 'core.continue', category: 'story', shape: 'cap', label: 'block.continue', args: [{ id: 'port', type: 'port', default: 'next' }], context: 'scene',
    run: (ctx: ScriptContext, a) => { needScene(ctx).exit(String(a.port || 'next')); throw new StopThread(); } });
  B({ id: 'core.gotoNode', category: 'story', shape: 'cap', label: 'block.gotoNode', args: [{ id: 'node', type: 'node' }],
    run: (ctx: ScriptContext, a) => { ctx.runtime.gotoNode(String(a.node)); throw new StopThread(); } });
}
