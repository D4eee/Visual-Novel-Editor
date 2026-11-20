import type { BlockDef, Engine } from '@vne/core';
import { truthy } from '@vne/core';
import type { ScriptContext } from '../script';
import { StopThread } from '../script';

const KEYS = ['Space', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((k) => `Key${k}`), ...'0123456789'.split('').map((d) => `Digit${d}`)];
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
  B({ id: 'core.whenMediaEnded', category: 'events', shape: 'hat', label: 'block.whenMediaEnded', args: [{ id: 'layer', type: 'layer' }], event: 'media.ended', context: 'scene', matches: (e, a) => e.layerId === a.layer });
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
  B({ id: 'core.forever', category: 'control', shape: 'c', label: 'block.forever', args: [],
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
    return (scene.data.animations || []).filter((c: any) => c.tracks.some((tr: any) => tr.layerId === id) || c.media.some((m: any) => m.layerId === id)).map((c: any) => c.id);
  };
  B({ id: 'core.startElement', category: 'elements', shape: 'statement', label: 'block.startElement', args: [{ id: 'layer', type: 'layer' }, { id: 'wait', type: 'boolean', default: false }],
    async run(ctx: ScriptContext, a) {
      const s = needScene(ctx);
      const l = s.layer(a.layer);
      if (!l) throw new Error(`Element "${a.layer}" is not in this scene`);
      s.setVisible(l.id, true);
      if (l.type === 'core.audio' || l.type === 'core.video') s.media(l.id, 'play');
      const runs = clipsOf(s, l.id).map((id) => s.playAnimation(id));
      if (a.wait) await Promise.all(runs);
    } });
  B({ id: 'core.stopElement', category: 'elements', shape: 'statement', label: 'block.stopElement', args: [{ id: 'layer', type: 'layer' }],
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
  B({ id: 'core.setText', category: 'looks', shape: 'statement', label: 'block.setText', args: [{ id: 'layer', type: 'layer' }, { id: 'text', type: 'expr', default: { k: 'lit', v: 'Hello' } }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'text', String(a.text)) });
  B({ id: 'core.setImage', category: 'looks', shape: 'statement', label: 'block.setImage', args: [{ id: 'layer', type: 'layer' }, { id: 'asset', type: 'asset', assetKind: 'image' }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'assetId', a.asset) });
  B({ id: 'core.setPortrait', category: 'looks', shape: 'statement', label: 'block.setPortrait', args: [{ id: 'layer', type: 'layer' }, { id: 'portrait', type: 'portrait', default: null }],
    run: (ctx: ScriptContext, a) => needScene(ctx).setProp(a.layer, 'portraitId', a.portrait) });
  B({ id: 'core.shakeScreen', category: 'looks', shape: 'statement', label: 'block.shakeScreen', args: [{ id: 'intensity', type: 'number', default: 12 }, { id: 'seconds', type: 'number', default: 0.5 }],
    async run(ctx: ScriptContext, a) { await needScene(ctx).shake(Number(a.intensity), Number(a.seconds), ctx.token); } });
  B({ id: 'core.flashScreen', category: 'looks', shape: 'statement', label: 'block.flashScreen', args: [{ id: 'color', type: 'string', default: '#ffffff' }, { id: 'seconds', type: 'number', default: 0.4 }],
    async run(ctx: ScriptContext, a) { await needScene(ctx).flash(String(a.color || '#fff'), Number(a.seconds), ctx.token); } });

  /* Sound -------------------------------------------------------------------- */
  B({ id: 'core.playMedia', category: 'sound', shape: 'statement', label: 'block.playMedia', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).media(a.layer, 'play') });
  B({ id: 'core.pauseMedia', category: 'sound', shape: 'statement', label: 'block.pauseMedia', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).media(a.layer, 'pause') });
  B({ id: 'core.stopMedia', category: 'sound', shape: 'statement', label: 'block.stopMedia', args: [{ id: 'layer', type: 'layer' }], run: (ctx: ScriptContext, a) => needScene(ctx).media(a.layer, 'stop') });
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
