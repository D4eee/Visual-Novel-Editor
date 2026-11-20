import type { Layer, LayerInstance, SceneData, StoryNode, Choice, PropDef, ModuleInstance, ComponentDef } from '@vne/core';
import { evaluateBool, applyVarOp, choicePort, Emitter } from '@vne/core';
import type { Project } from '@vne/core';
import { interpolateVars } from './text';
import type { VarStore } from './state';

export function interpolateVarsCompat(text: string, project: Project, vars: VarStore): string {
  return interpolateVars(text, (name) => {
    const v = project.variables.find((x) => x.name === name) || vars.byName(name);
    if (!v) return undefined;
    const val = vars.get(v.id);
    return val === undefined ? undefined : String(val);
  });
}
import { AnimationPlayer, propKind } from './animation';
import { ScriptEngine, ScriptHost, CancelToken, RuntimeEvent } from './script';
import type { SceneView } from './render';
import { hitTest, computeDrives } from './render';
import { lerp, lerpColor, num } from './math';
import { portraitAsset } from './builtins/layers';
import type { GameRuntime } from './game';

interface Tween { layerId: string; prop: string; from: any; to: any; elapsed: number; dur: number; ease: string; kind: 'number' | 'color' | 'discrete'; resolve: () => void; token?: CancelToken }

/**
 * A playing scene: live layer state, animations, scripts, dialogue and choices.
 * `play()` resolves with the output port the story continues from.
 */
export class ScenePlayer {
  readonly data: SceneData;
  readonly layerState = new Map<string, Record<string, any>>();
  readonly visibleState = new Map<string, boolean>();
  readonly instances = new Map<string, LayerInstance>();
  readonly events = new Emitter<Record<string, RuntimeEvent>>();
  readonly anim: AnimationPlayer;
  readonly scripts: ScriptEngine;
  readonly view: SceneView;
  private tweens: Tween[] = [];
  private choiceVisible = new Map<string, boolean>();
  private components: { def: ComponentDef; inst: ModuleInstance; state: any }[] = [];
  private exitResolve!: (port: string) => void;
  private exited = false;
  private advanceWaiter: (() => void) | null = null;
  private jumpTo: number | null = null;
  private choicePickResolve: ((id: string) => void) | null = null;
  private choicesShown = false;
  private hoverId: string | null = null;
  private drives = new Map<string, Record<string, any>>();
  private unsub: (() => void)[] = [];
  lineIndex = 0;
  time = 0;
  textboxVisible: boolean;
  exitPort: string | null = null;

  constructor(readonly rt: GameRuntime, readonly node: StoryNode<SceneData>, private resumeLine = 0) {
    this.data = node.data;
    this.textboxVisible = !this.data.hideTextbox;
    for (const l of this.data.layers) {
      this.layerState.set(l.id, { ...l.props });
      this.visibleState.set(l.id, l.visible);
    }
    for (const c of this.data.choices) this.choiceVisible.set(c.id, !c.hidden);
    const engine = rt.engine;
    this.view = {
      engine, project: rt.project, assets: rt.assets, layers: this.data.layers, mode: 'play', time: 0, vars: rt.vars,
      props: (l: Layer) => {
        const base = this.layerState.get(l.id) || l.props;
        const d = this.drives.get(l.id);
        return d ? { ...base, ...d } : base;
      },
      visible: (l: Layer) => this.visibleState.get(l.id) ?? l.visible,
      instance: (id: string) => this.instances.get(id),
      pool: rt.pool, shaders: rt.shaders, errors: new Map(),
      reportError: (source, err) => rt.reportError(source, err, { nodeId: node.id }),
    };
    this.anim = new AnimationPlayer(
      engine,
      () => this.data.animations,
      (layerId, prop) => this.propDef(layerId, prop),
      (layerId, prop, v) => this.writeProp(layerId, prop, v),
      (animId) => this.dispatch({ type: 'anim.finished', animId }),
      { play: (id, offset) => this.instances.get(id)?.play?.(offset), stop: (id) => this.instances.get(id)?.stop?.() },
    );
    const host: ScriptHost = {
      engine, project: rt.project, vars: rt.vars, scene: this, runtime: rt.api,
      sleep: (s, tok) => rt.sleep(s, tok),
      nextFrame: (tok) => rt.nextFrame(tok),
      emit: (e) => this.dispatch(e),
      reportError: (source, err, extra) => rt.reportError(source, err, { ...extra, nodeId: node.id }),
    };
    this.scripts = new ScriptEngine(host, () => this.data.scripts);
  }

  propDef(layerId: string, prop: string): PropDef | undefined {
    const l = this.data.layers.find((x) => x.id === layerId);
    return l ? this.rt.engine.layerProps(l.type).find((p) => p.key === prop) : undefined;
  }

  private writeProp(layerId: string, prop: string, value: any): void {
    const s = this.layerState.get(layerId);
    if (s) s[prop] = value;
  }

  /* ----------------------------------------------------------------- */
  /* Lifecycle                                                          */
  /* ----------------------------------------------------------------- */

  play(): Promise<string> {
    const done = new Promise<string>((res) => (this.exitResolve = res));
    this.vars.enterScene(this.data.localVariables || []);
    this.unsub.push(this.rt.vars.events.on('change', (c) => {
      this.dispatch({ type: 'var.changed', varId: c.id, value: c.value });
      if (this.choicesShown) this.renderChoices();
    }));
    const lrt = { assets: this.rt.assets, audio: this.rt.audio, mode: 'play' as const, emit: (e: RuntimeEvent) => this.dispatch(e), requestRender: () => {} };
    for (const l of this.data.layers) {
      const def = this.rt.engine.layerTypes.get(l.type);
      if (!def?.createInstance) continue;
      try {
        const inst = def.createInstance(l, lrt);
        if (inst) this.instances.set(l.id, inst);
      } catch (err) {
        this.rt.reportError(`layer:${l.type}`, err, { nodeId: this.node.id, layerId: l.id });
      }
    }
    // autoplay media
    for (const l of this.data.layers) {
      const p = this.layerState.get(l.id)!;
      if ((l.type === 'core.audio' || l.type === 'core.video') && p.autoplay && this.visibleState.get(l.id) !== false) this.instances.get(l.id)?.play?.(0);
    }
    for (const a of this.data.animations) if (a.autoplay) this.anim.play(a.id);
    // node components (module instances)
    for (const inst of this.node.modules || []) {
      if (!inst.enabled) continue;
      const def = this.rt.engine.components.get(inst.component);
      if (!def) { this.rt.reportError(`module:${inst.moduleId}`, new Error(`Component "${inst.component}" is not available; its data is kept.`), { nodeId: this.node.id }); continue; }
      const state = {};
      this.components.push({ def, inst, state });
      if (def.sceneEnter) {
        try { const r = def.sceneEnter(this.componentContext(inst), inst.data, state); if (r && typeof (r as any).catch === 'function') (r as Promise<void>).catch((err) => this.rt.reportError(`module:${inst.moduleId}`, err, { nodeId: this.node.id })); }
        catch (err) { this.rt.reportError(`module:${inst.moduleId}`, err, { nodeId: this.node.id }); }
      }
    }
    this.scripts.start();
    this.dispatch({ type: 'scene.enter' });
    this.lineIndex = Math.max(0, Math.min(this.resumeLine, this.data.dialogue.length));
    this.runNarrative().catch((err) => this.rt.reportError('scene', err, { nodeId: this.node.id }));
    return done;
  }

  private get vars() { return this.rt.vars; }

  componentContext(inst: ModuleInstance) {
    return {
      runtime: this.rt.api,
      scene: this,
      vars: this.rt.vars,
      data: inst.data,
      instanceId: inst.id,
      on: (type: string, fn: (e: RuntimeEvent) => void) => { const off = this.events.on(type, fn); this.unsub.push(off); return off; },
      emit: (e: RuntimeEvent) => this.dispatch(e),
      overlay: this.rt.hud,
    };
  }

  dispatch(e: RuntimeEvent): number {
    if (this.exited && e.type !== 'scene.exit') return 0;
    this.rt.debugEvent(e);
    this.events.emit(e.type, e);
    this.rt.api.events.emit(e.type, { ...e, sceneId: this.node.id });
    return this.scripts.dispatch(e);
  }

  /** Called by blocks or modules to leave the scene through an output port. */
  exit(port: string): void {
    if (this.exited) return;
    this.exitPort = port;
    this.dispatch({ type: 'scene.exit', port });
    this.exited = true;
    this.advanceWaiter?.();
    this.choicePickResolve?.('__exit');
    this.exitResolve(port);
  }

  get isExited(): boolean {
    return this.exited;
  }

  dispose(): void {
    this.scripts.stopAll();
    this.anim.stopAll();
    for (const c of this.components) {
      try { c.def.sceneExit?.(this.componentContext(c.inst), c.inst.data, c.state); }
      catch (err) { this.rt.reportError(`module:${c.inst.moduleId}`, err, { nodeId: this.node.id }); }
    }
    for (const f of this.unsub) f();
    for (const [id, inst] of this.instances) {
      try { inst.dispose?.(); } catch (err) { this.rt.reportError('layer', err, { layerId: id }); }
    }
    this.instances.clear();
    this.rt.vars.exitScene();
    this.rt.narrative.hideChoices();
  }

  /* ----------------------------------------------------------------- */
  /* Dialogue and choices                                               */
  /* ----------------------------------------------------------------- */

  private waitAdvance(): Promise<void> {
    return new Promise((res) => { this.advanceWaiter = () => { this.advanceWaiter = null; res(); }; });
  }

  /** Player or script request to continue. Completes the typewriter first. */
  advance(): void {
    if (this.exited) return;
    if (this.rt.narrative.isTyping) { this.currentTyping?.complete(); return; }
    this.advanceWaiter?.();
  }

  private currentTyping: { complete(): void; done: Promise<void>; finished: boolean } | null = null;

  gotoLine(lineId: string): void {
    const i = this.data.dialogue.findIndex((l) => l.id === lineId);
    if (i < 0) return;
    this.jumpTo = i;
    this.currentTyping?.complete();
    this.advanceWaiter?.();
  }

  setTextboxVisible(v: boolean): void {
    this.textboxVisible = v;
    this.rt.narrative.setBoxVisible(v && this.lineIndex < this.data.dialogue.length);
  }

  private async runNarrative(): Promise<void> {
    const lines = this.data.dialogue;
    const ui = this.rt.narrative;
    if (!lines.length) ui.setBoxVisible(false);
    while (!this.exited && this.lineIndex < lines.length) {
      const line = lines[this.lineIndex];
      const ch = this.rt.project.characters.find((c) => c.id === line.speakerId);
      const name = line.speakerName || ch?.name || '';
      const portraitId = line.portraitId || null;
      const pAsset = ch ? portraitAsset(this.rt.project, ch.id, portraitId) : null;
      // Characters on stage take the expression chosen for their line.
      if (ch && portraitId) for (const l of this.data.layers) if (l.type === 'core.character' && l.props.characterId === ch.id) this.setProp(l.id, 'portraitId', portraitId);
      const text = interpolateVarsCompat(line.text, this.rt.project, this.rt.vars);
      this.rt.narrative.setBoxVisible(this.textboxVisible);
      const typing = ui.showLine({ name, nameColor: ch?.color, portraitUrl: pAsset ? this.rt.assets.url(pAsset) : null, text }, this.rt.skipMode ? 0 : this.rt.settings.textSpeed);
      this.currentTyping = typing;
      this.rt.backlogPush({ kind: 'line', name, text, nodeId: this.node.id });
      if (line.voiceAssetId) this.rt.playVoice(line.voiceAssetId);
      this.dispatch({ type: 'dialogue.line', lineId: line.id, index: this.lineIndex });
      // wait for the typewriter (or a click that completes it)
      await Promise.race([typing.done, this.waitAdvance()]);
      if (this.exited) return;
      if (this.jumpTo === null) {
        const autoDelay = line.auto && line.auto > 0 ? line.auto : this.rt.autoMode ? this.rt.settings.autoDelay : 0;
        if (this.rt.skipMode) await this.rt.sleepPlain(0.06);
        else if (autoDelay > 0) await Promise.race([this.rt.sleepPlain(autoDelay), this.waitAdvance()]);
        else await this.waitAdvance();
      }
      if (this.exited) return;
      if (this.jumpTo !== null) { this.lineIndex = this.jumpTo; this.jumpTo = null; continue; }
      this.lineIndex++;
    }
    if (this.exited) return;
    this.dispatch({ type: 'dialogue.end' });
    if (this.exited) return;
    if (this.data.choices.length) {
      const picked = await this.askChoices();
      if (this.exited || picked === '__exit') return;
      const choice = this.data.choices.find((c) => c.id === picked)!;
      for (const op of choice.effects) this.rt.vars.set(op.varId, applyVarOp(this.rt.vars.def(op.varId), this.rt.vars.get(op.varId), op));
      this.rt.backlogPush({ kind: 'choice', name: '', text: choice.text, nodeId: this.node.id });
      this.dispatch({ type: 'choice.selected', choiceId: choice.id });
      if (choice.animationId) await this.anim.play(choice.animationId);
      this.exit(choicePort(choice.id));
      return;
    }
    if (!lines.length) {
      ui.setBoxVisible(false);
      if (this.data.holdSeconds > 0) await Promise.race([this.rt.sleepPlain(this.data.holdSeconds), this.waitAdvance()]);
      else await this.waitAdvance();
    }
    this.exit('next');
  }

  availableChoices(): { choice: Choice; disabled: boolean }[] {
    const out: { choice: Choice; disabled: boolean }[] = [];
    for (const c of this.data.choices) {
      if (!this.choiceVisible.get(c.id)) continue;
      let ok = true;
      try { ok = evaluateBool(c.condition, this.rt.vars, this.rt.functions); }
      catch (err) { this.rt.reportError('choice', err, { nodeId: this.node.id }); }
      if (!ok && c.unavailable === 'hide') continue;
      out.push({ choice: c, disabled: !ok });
    }
    return out;
  }

  private askChoices(): Promise<string> {
    this.choicesShown = true;
    if (!this.data.dialogue.length) this.rt.narrative.setBoxVisible(false);
    return new Promise((res) => {
      this.choicePickResolve = (id) => { this.choicePickResolve = null; this.choicesShown = false; this.rt.narrative.hideChoices(); res(id); };
      this.renderChoices();
    });
  }

  private renderChoices(): void {
    const list = this.availableChoices();
    this.rt.narrative.showChoices(list.map(({ choice, disabled }) => ({ id: choice.id, text: interpolateVarsCompat(choice.text, this.rt.project, this.rt.vars), disabled })), (id) => this.choicePickResolve?.(id));
    if (!list.length) this.rt.reportError('choice', new Error('No choice is available here; the story cannot continue. Add a condition fallback or an always-available choice.'), { nodeId: this.node.id });
  }

  setChoiceVisible(choiceId: string, v: boolean): void {
    this.choiceVisible.set(choiceId, v);
    if (this.choicesShown) this.renderChoices();
  }

  /** Programmatic choice selection (used by tests, modules and keyboard shortcuts). */
  pickChoice(choiceId: string): boolean {
    if (!this.choicePickResolve) return false;
    const ok = this.availableChoices().some((c) => c.choice.id === choiceId && !c.disabled);
    if (ok) this.choicePickResolve(choiceId);
    return ok;
  }

  /* ----------------------------------------------------------------- */
  /* Layer API (used by blocks and modules)                             */
  /* ----------------------------------------------------------------- */

  layer(id: string): Layer | undefined {
    return this.data.layers.find((l) => l.id === id) || this.data.layers.find((l) => l.name === id);
  }

  private resolveLayer(id: string): string {
    const l = this.layer(id);
    if (!l) throw new Error(`Layer "${id}" is not in this scene`);
    return l.id;
  }

  getProp(layerId: string, prop: string): any {
    return this.layerState.get(this.resolveLayer(layerId))?.[prop];
  }

  setProp(layerId: string, prop: string, value: any): void {
    const id = this.resolveLayer(layerId);
    if (prop === 'visible') { this.setVisible(id, !!value); return; }
    const def = this.propDef(id, prop);
    if (def?.type === 'number') value = num(value);
    this.writeProp(id, prop, value);
  }

  setVisible(layerId: string, v: boolean): void {
    const id = this.resolveLayer(layerId);
    this.visibleState.set(id, v);
  }

  tween(layerId: string, prop: string, to: any, seconds: number, ease = 'easeInOut', token?: CancelToken): Promise<void> {
    const id = this.resolveLayer(layerId);
    const from = this.layerState.get(id)?.[prop];
    const kind = propKind(this.propDef(id, prop), from);
    this.tweens = this.tweens.filter((t) => { if (t.layerId === id && t.prop === prop) { t.resolve(); return false; } return true; });
    if (seconds <= 0) { this.writeProp(id, prop, to); return Promise.resolve(); }
    return new Promise((resolve) => {
      const tw: Tween = { layerId: id, prop, from, to, elapsed: 0, dur: seconds, ease, kind, resolve, token };
      token?.onCancel(() => { this.tweens = this.tweens.filter((x) => x !== tw); resolve(); });
      this.tweens.push(tw);
    });
  }

  playAnimation(animId: string): Promise<void> {
    if (!this.data.animations.some((a) => a.id === animId)) throw new Error('Animation not found in this scene');
    return this.anim.play(animId);
  }

  stopAnimation(animId: string): void {
    this.anim.stop(animId);
  }

  media(layerId: string, action: 'play' | 'pause' | 'stop'): void {
    const inst = this.instances.get(this.resolveLayer(layerId));
    if (!inst) return;
    if (action === 'play') inst.play?.(); else if (action === 'pause') inst.pause?.(); else inst.stop?.();
  }

  shake(intensity: number, seconds: number, token?: CancelToken): Promise<void> {
    return this.rt.shake(intensity, seconds, token);
  }

  flash(color: string, seconds: number, token?: CancelToken): Promise<void> {
    return this.rt.flash(color, seconds, token);
  }

  /* ----------------------------------------------------------------- */
  /* Frame                                                              */
  /* ----------------------------------------------------------------- */

  update(dt: number): void {
    this.time += dt;
    this.view.time = this.time;
    this.anim.update(dt);
    if (this.tweens.length) {
      for (const tw of [...this.tweens]) {
        tw.elapsed += dt;
        const u = Math.min(1, tw.elapsed / tw.dur);
        const interp = this.rt.engine.interpolators.get(tw.ease) || this.rt.engine.interpolators.get('linear')!;
        const e = interp.ease(u);
        const v = tw.kind === 'number' ? lerp(num(tw.from), num(tw.to), e) : tw.kind === 'color' ? lerpColor(tw.from, tw.to, e) : u >= 1 ? tw.to : tw.from;
        this.writeProp(tw.layerId, tw.prop, v);
        if (u >= 1) { this.tweens = this.tweens.filter((x) => x !== tw); tw.resolve(); }
      }
    }
    for (const l of this.data.layers) {
      const inst = this.instances.get(l.id);
      if (inst?.update) {
        try { inst.update(dt, this.view.props(l), this.time); } catch (err) { this.rt.reportError(`layer:${l.type}`, err, { layerId: l.id }); }
      }
    }
    for (const c of this.components) {
      if (!c.def.frame) continue;
      try { c.def.frame(this.componentContext(c.inst), c.inst.data, dt, c.state); }
      catch (err) { this.rt.reportError(`module:${c.inst.moduleId}`, err, { nodeId: this.node.id }); }
    }
    this.view.errors.clear();
    // Drivers read base values (not last frame's driven values) so relationships never feed back.
    this.drives = new Map();
    this.drives = computeDrives(this.view);
  }

  /* ----------------------------------------------------------------- */
  /* Input                                                              */
  /* ----------------------------------------------------------------- */

  private isInteractive(l: Layer): boolean {
    if (l.type === 'core.button' || l.type === 'core.hotspot') return true;
    return this.scripts.listens('layer.click', (a) => a.layer === l.id) || this.scripts.listens('layer.hoverEnter', (a) => a.layer === l.id);
  }

  /** Returns true if the click was consumed by an interactive layer. */
  pointerDown(x: number, y: number): boolean {
    if (this.exited) return true;
    const hit = hitTest(this.view, x, y, (l) => this.isInteractive(l));
    if (!hit) return false;
    if (hit.type === 'core.button' && this.layerState.get(hit.id)?.enabled === false) return true;
    this.dispatch({ type: 'layer.click', layerId: hit.id });
    return true;
  }

  pointerMove(x: number, y: number): string {
    const hit = hitTest(this.view, x, y, (l) => this.isInteractive(l));
    const id = hit?.id ?? null;
    if (id !== this.hoverId) {
      if (this.hoverId) { const prev = this.instances.get(this.hoverId); if (prev) prev.hover = false; this.dispatch({ type: 'layer.hoverLeave', layerId: this.hoverId }); }
      if (id) { const inst = this.instances.get(id); if (inst) inst.hover = true; this.dispatch({ type: 'layer.hoverEnter', layerId: id }); }
      this.hoverId = id;
    }
    if (!hit) return 'default';
    return hit.type === 'core.hotspot' ? (this.layerState.get(hit.id)?.cursor || 'pointer') : 'pointer';
  }

  key(code: string): boolean {
    return this.dispatch({ type: 'key.down', code }) > 0;
  }
}
