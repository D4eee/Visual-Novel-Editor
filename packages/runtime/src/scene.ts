import type { Layer, LayerInstance, SceneData, StoryNode, Choice, PropDef, ModuleInstance, ComponentDef, AnimationClip, ScriptStack } from '@vne/core';
import { evaluateBool, applyVarOp, choicePort, Emitter, sceneLines, sceneChoices, CHOICE_LAYER, leavePolicies, isContinuousScript, scriptElements, newId, isMusic } from '@vne/core';
import type { Project } from '@vne/core';
import { interpolateVars } from './text';
import type { VarStore } from './state';

export function interpolateVarsCompat(text: string, project: Project, vars: VarStore): string {
  return interpolateVars(text, (name) => {
    const v = project.variables.find((x) => x.name === name) || vars.byName(name);
    if (!v) return undefined;
    const val = vars.get(v.id);
    return val === undefined ? undefined : Array.isArray(val) ? val.join(', ') : String(val);
  });
}
import { AnimationPlayer, propKind } from './animation';
import type { PlayingClip } from './animation';
import { paramDefaults } from './globals';
import { ScriptEngine, ScriptHost, CancelToken, RuntimeEvent } from './script';
import type { SceneView } from './render';
import { hitTest, computeDrives, layerContains, layerBounds, effectiveVisible, layerLocalPoint } from './render';
import { lerp, lerpColor, num } from './math';
import { portraitAsset } from './builtins/layers';
import type { GameRuntime } from './game';

/** An element that keeps running from the previous page. */
export interface CarriedLayer {
  layer: Layer;
  /** The page it was created on. */
  from: string;
  paused: boolean;
  state: Record<string, any>;
  visible: boolean;
  instance?: LayerInstance;
}

export interface CarriedScript {
  stack: ScriptStack;
  from: string;
  paused: boolean;
  /** It had a thread running (a loop) when the page changed: it starts again on the new page. */
  running: boolean;
}

/** What one page hands to the next (see inherit.ts in core for the rules). */
export interface Carry {
  layers: CarriedLayer[];
  scripts: CarriedScript[];
  clips: PlayingClip[];
}

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
  /** Choice elements currently offered to the player. */
  private offered = new Map<string, { disabled: boolean }>();
  private hoverId: string | null = null;
  private drives = new Map<string, Record<string, any>>();
  private unsub: (() => void)[] = [];
  lineIndex = 0;
  time = 0;
  textboxVisible: boolean;
  exitPort: string | null = null;
  /** Every element on this page, bottom to top: global (behind), carried backgrounds, own, carried, labels, global (front). */
  layers: Layer[] = [];
  /** Elements continuing from earlier pages. */
  readonly carried = new Map<string, CarriedLayer>();
  /** Global elements (shared by every page). */
  readonly globalIds = new Set<string>();
  /** Paused elements (media, animations and frame playback stop) and scripts. */
  readonly pausedLayers = new Set<string>();
  readonly pausedScripts = new Set<string>();
  /** Text labels shown by this page's scripts. */
  readonly labels: Layer[] = [];
  /** Live label texts (re-evaluated every frame). */
  private labelValues = new Map<string, () => string>();
  /** "When the page changes" rules met while the page played. */
  readonly leave = { removeLayers: new Set<string>(), pauseLayers: new Set<string>(), removeScripts: new Set<string>(), pauseScripts: new Set<string>() };
  private carriedScripts: CarriedScript[] = [];
  private carriedClips: AnimationClip[] = [];
  private zOrder: { id: string; to: 'front' | 'back' }[] = [];
  private frozenRunning = new Set<string>();
  private handedOff = new Set<string>();

  constructor(readonly rt: GameRuntime, readonly node: StoryNode<SceneData>, private resumeLine = 0, carry: Carry | null = null) {
    this.data = node.data;
    this.textboxVisible = !this.data.hideTextbox;
    const g = rt.globals;
    g.ensure();
    for (const l of this.data.layers) {
      this.layerState.set(l.id, { ...paramDefaults(l), ...l.props });
      this.visibleState.set(l.id, l.visible && !rt.items.collected.has(`${node.id}:${l.id}`));
    }
    for (const l of g.layers) {
      this.globalIds.add(l.id);
      this.layerState.set(l.id, g.layerState.get(l.id)!);
      this.visibleState.set(l.id, g.visibleState.get(l.id) ?? l.visible);
      const inst = g.instances.get(l.id);
      if (inst) this.instances.set(l.id, inst);
    }
    for (const l of g.labels) { this.layerState.set(l.id, { ...l.props }); this.visibleState.set(l.id, true); }
    for (const c of carry?.layers || []) {
      if (this.layerState.has(c.layer.id)) continue;
      this.carried.set(c.layer.id, c);
      this.layerState.set(c.layer.id, c.state);
      this.visibleState.set(c.layer.id, c.visible);
      if (c.instance) this.instances.set(c.layer.id, c.instance);
      if (c.paused) this.pausedLayers.add(c.layer.id);
    }
    this.carriedScripts = (carry?.scripts || []).filter((c) => !this.data.scripts.some((x) => x.id === c.stack.id));
    for (const c of this.carriedScripts) if (c.paused) this.pausedScripts.add(c.stack.id);
    this.carriedClips = (carry?.clips || []).map((p) => p.clip);
    for (const c of sceneChoices(this.data)) this.choiceVisible.set(c.id, !c.hidden);
    const engine = rt.engine;
    this.view = {
      engine, project: rt.project, assets: rt.assets, layers: [], mode: 'play', time: 0, vars: rt.vars,
      items: { list: (v) => rt.items.list(v ?? null), selected: () => rt.items.selected },
      props: (l: Layer) => {
        const base = this.layerState.get(l.id) || l.props;
        const d = this.drives.get(l.id);
        return d ? { ...base, ...d } : base;
      },
      visible: (l: Layer) => (l.type === CHOICE_LAYER ? this.offered.has(l.id) : true) && (this.visibleState.get(l.id) ?? l.visible),
      instance: (id: string) => this.instances.get(id),
      choiceState: (id: string) => (this.offered.has(id) ? { hover: this.hoverId === id, disabled: !!this.offered.get(id)?.disabled } : null),
      pool: rt.pool, shaders: rt.shaders, errors: new Map(),
      reportError: (source, err) => rt.reportError(source, err, { nodeId: node.id }),
    };
    this.rebuildLayers();
    this.anim = new AnimationPlayer(
      engine,
      () => this.clips,
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
      trace: (blockId) => rt.debug.emit('block', { blockId, nodeId: node.id }),
    };
    host.functions = rt.functions;
    this.scripts = new ScriptEngine(host, () => this.stacks);
    // Scripts continuing from the last page do not start again on "when the page starts".
    const carriedIds = new Set(this.carriedScripts.map((c) => c.stack.id));
    this.scripts.skip = (st, e) => e.type === 'scene.enter' && carriedIds.has(st.id);
    for (const p of carry?.clips || []) {
      this.anim.adopt(p);
      const layers = p.clip.tracks.map((t) => t.layerId);
      if (layers.length && layers.every((id) => this.pausedLayers.has(id))) this.anim.setPaused(p.clip.id, true);
    }
  }

  /** Scripts of this page: the global page's, the carried ones (unless paused) and its own. */
  get stacks(): ScriptStack[] {
    const all = [...(this.rt.globals.data?.scripts || []), ...this.carriedScripts.map((c) => c.stack), ...this.data.scripts];
    return all.filter((s) => !this.pausedScripts.has(s.id));
  }

  /** Every script on this page, paused ones included. */
  get allStacks(): ScriptStack[] {
    return [...(this.rt.globals.data?.scripts || []), ...this.carriedScripts.map((c) => c.stack), ...this.data.scripts];
  }

  get clips(): AnimationClip[] {
    return [...(this.rt.globals.data?.animations || []), ...this.carriedClips, ...this.data.animations];
  }

  /** Is this script from the global page? */
  isGlobalScript(stackId: string): boolean {
    return !!this.rt.globals.data?.scripts.some((s) => s.id === stackId);
  }

  private rebuildLayers(): void {
    const g = this.rt.globals;
    const back = g.layers.filter((l) => l.zone === 'back');
    const front = g.layers.filter((l) => l.zone !== 'back');
    const carried = [...this.carried.values()].map((c) => c.layer);
    let list = [...back, ...carried.filter((l) => l.type === 'core.background'), ...this.data.layers, ...carried.filter((l) => l.type !== 'core.background'), ...this.labels, ...front, ...g.labels];
    for (const z of this.zOrder) {
      const i = list.findIndex((l) => l.id === z.id);
      if (i < 0) continue;
      const [l] = list.splice(i, 1);
      if (z.to === 'front') list.push(l); else list.unshift(l);
    }
    this.layers = list;
    this.view.layers = list;
  }

  propDef(layerId: string, prop: string): PropDef | undefined {
    const l = this.layer(layerId);
    if (!l) return undefined;
    if (prop.startsWith('param.')) {
      const pd = (l.params || []).find((x) => `param.${x.id}` === prop);
      return pd ? { key: prop, type: pd.type === 'number' ? 'number' : pd.type === 'boolean' ? 'boolean' : 'string', label: pd.name, animatable: pd.type === 'number' } : undefined;
    }
    return this.rt.engine.layerProps(l.type).find((p) => p.key === prop);
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
    // Instances may continue on later pages: their events go to whichever page is playing.
    const lrt = { assets: this.rt.assets, audio: this.rt.audio, mode: 'play' as const, emit: (e: RuntimeEvent) => (this.rt.scene || this).dispatch(e), requestRender: () => {} };
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
    for (const id of this.pausedLayers) this.instances.get(id)?.pause?.();
    for (const a of this.rt.globals.data?.animations || []) if (a.autoplay) this.anim.play(a.id);
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
    // Loops that were running on the last page carry on.
    for (const c of this.carriedScripts) if (!c.paused && c.running && !this.scripts.hasSetup(c.stack)) this.scripts.spawn(c.stack, null);
    this.dispatch({ type: 'scene.enter' });
    this.lineIndex = Math.max(0, Math.min(this.resumeLine, this.lines.length));
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

  /** The page ended: remember which loops were running, then stop the scripts. */
  freeze(): void {
    this.frozenRunning = this.scripts.runningStacks();
    this.scripts.stopAll();
  }

  /**
   * What continues on the next page: running media, looping animations, running loops and
   * timers and the elements they use, and what this page inherited — minus what the
   * "when the page changes, remove" rules drop; "pause" rules carry it paused.
   */
  handOff(next: StoryNode<SceneData> | null): Carry {
    const engine = this.rt.engine;
    const pol = leavePolicies(engine, this.allStacks.filter((s) => !this.isGlobalScript(s.id)));
    for (const k of ['removeLayers', 'pauseLayers', 'removeScripts', 'pauseScripts'] as const) for (const id of this.leave[k]) pol[k].add(id);
    for (const id of pol.removeLayers) pol.pauseLayers.delete(id);
    const nextLayers = new Set(next?.data.layers.map((l) => l.id) || []);
    const nextScripts = new Set(next?.data.scripts.map((s) => s.id) || []);
    const keep = new Map<string, boolean>(); // id → paused
    const local = (id: string) => this.data.layers.find((l) => l.id === id) || this.carried.get(id)?.layer;
    const mark = (id: string, paused: boolean) => {
      if (!local(id)) return;
      keep.set(id, keep.has(id) ? keep.get(id)! && paused : paused);
    };
    const scripts: CarriedScript[] = [];
    const candidates: CarriedScript[] = [
      ...this.carriedScripts.map((c) => ({ ...c, paused: this.pausedScripts.has(c.stack.id) })),
      ...this.data.scripts.map((st) => ({ stack: st, from: this.node.id, paused: false, running: false })),
    ];
    for (const c of candidates) {
      const st = c.stack;
      if (!st.enabled || pol.removeScripts.has(st.id) || nextScripts.has(st.id)) continue;
      const running = this.frozenRunning.has(st.id);
      const lives = c.paused || this.scripts.hasSetup(st) || (running && isContinuousScript(st));
      if (!lives) continue;
      const paused = c.paused || pol.pauseScripts.has(st.id);
      scripts.push({ stack: st, from: c.from, paused, running: c.paused ? c.running : running });
      for (const id of scriptElements(engine, st)) mark(id, paused);
    }
    for (const l of [...this.data.layers, ...[...this.carried.values()].map((c) => c.layer)]) {
      const inst = this.instances.get(l.id);
      if (inst?.isPlaying?.()) mark(l.id, false);
      else if (this.carried.has(l.id) && this.pausedLayers.has(l.id) && (l.type === 'core.audio' || l.type === 'core.video')) mark(l.id, true);
    }
    const clips: PlayingClip[] = [];
    for (const clip of [...this.carriedClips, ...this.data.animations]) {
      const p = this.anim.playing.get(clip.id);
      if (!p || p.done || !p.loop) continue;
      for (const t of clip.tracks) mark(t.layerId, !!p.paused);
    }
    // Groups take their contents along.
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of [...this.data.layers, ...[...this.carried.values()].map((c) => c.layer)]) {
        if (l.parentId && keep.has(l.parentId) && !keep.has(l.id)) { keep.set(l.id, keep.get(l.parentId)!); grew = true; }
      }
    }
    for (const id of pol.removeLayers) keep.delete(id);
    for (const id of nextLayers) keep.delete(id);
    // The next page's own music replaces the music channel (it cross-fades by itself).
    if (next?.data.layers.some((l) => isMusic(l) && l.props.autoplay && l.visible !== false)) for (const id of [...keep.keys()]) { const l = local(id); if (l && isMusic(l)) keep.delete(id); }
    // Removed media fall silent.
    for (const l of [...this.data.layers, ...[...this.carried.values()].map((c) => c.layer)]) {
      if (!keep.has(l.id) && pol.removeLayers.has(l.id)) { try { this.instances.get(l.id)?.stop?.(); } catch { /* ignore */ } }
    }
    const layers: CarriedLayer[] = [];
    for (const [id, pausedFlag] of keep) {
      const layer = local(id)!;
      const paused = pausedFlag || pol.pauseLayers.has(id) || (this.pausedLayers.has(id) && !pol.removeLayers.has(id));
      layers.push({ layer, from: this.carried.get(id)?.from || this.node.id, paused, state: this.layerState.get(id)!, visible: this.visibleState.get(id) ?? layer.visible, instance: this.instances.get(id) });
      this.handedOff.add(id);
    }
    for (const clip of [...this.carriedClips, ...this.data.animations]) {
      const p = this.anim.playing.get(clip.id);
      if (!p || p.done || !p.loop || !clip.tracks.length || !clip.tracks.every((t) => keep.has(t.layerId))) continue;
      const taken = this.anim.detach(clip.id);
      if (taken) clips.push(taken);
    }
    // Keep the order the elements had.
    const order = new Map(this.layers.map((l, i) => [l.id, i]));
    layers.sort((a, b) => (order.get(a.layer.id) ?? 0) - (order.get(b.layer.id) ?? 0));
    return { layers, scripts, clips };
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
      if (this.handedOff.has(id) || this.globalIds.has(id)) continue;
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
    const i = this.lines.findIndex((l) => l.id === lineId);
    if (i < 0) return;
    this.jumpTo = i;
    this.currentTyping?.complete();
    this.advanceWaiter?.();
  }

  setTextboxVisible(v: boolean): void {
    this.textboxVisible = v;
    this.rt.narrative.setBoxVisible(v && this.lineIndex < this.lines.length);
  }

  /** The scene's dialogue lines (from its dialogue element). */
  get lines() { return sceneLines(this.data); }

  private async runNarrative(): Promise<void> {
    const lines = this.lines;
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
    const choices = sceneChoices(this.data);
    if (choices.length) {
      const picked = await this.askChoices();
      if (this.exited || picked === '__exit') return;
      const choice = choices.find((c) => c.id === picked)!;
      for (const op of choice.effects) this.rt.vars.set(op.varId, applyVarOp(this.rt.vars.def(op.varId), this.rt.vars.get(op.varId), op));
      if (choice.requiresItem && choice.consumeItem) this.rt.items.remove(choice.requiresItem);
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
    for (const c of sceneChoices(this.data)) {
      if (!this.choiceVisible.get(c.id)) continue;
      let ok = true;
      try { ok = evaluateBool(c.condition, this.rt.vars, this.rt.functions); }
      catch (err) { this.rt.reportError('choice', err, { nodeId: this.node.id }); }
      if (ok && c.requiresItem && !this.rt.items.has(c.requiresItem)) ok = false;
      if (!ok && c.unavailable === 'hide') continue;
      out.push({ choice: c, disabled: !ok });
    }
    return out;
  }

  private askChoices(): Promise<string> {
    this.choicesShown = true;
    if (!this.lines.length) this.rt.narrative.setBoxVisible(false);
    return new Promise((res) => {
      this.choicePickResolve = (id) => { this.choicePickResolve = null; this.choicesShown = false; this.offered.clear(); res(id); };
      this.renderChoices();
    });
  }

  private renderChoices(): void {
    const list = this.availableChoices();
    this.offered = new Map(list.map(({ choice, disabled }) => [choice.id, { disabled }]));
    if (!list.length) this.rt.reportError('choice', new Error('No choice is available here; the story cannot continue. Add a condition fallback or an always-available choice.'), { nodeId: this.node.id });
  }

  setChoiceVisible(choiceId: string, v: boolean): void {
    this.choiceVisible.set(choiceId, v);
    if (this.choicesShown) this.renderChoices();
  }

  /** True while the player is choosing. */
  get choicesOpen(): boolean { return this.choicesShown; }

  /** Keyboard 1–9: the n-th offered choice in reading order. */
  pickChoiceByIndex(i: number): boolean {
    const list = this.availableChoices().filter((c) => !c.disabled);
    return list[i] ? this.pickChoice(list[i].choice.id) : false;
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
    if (!id) return undefined;
    return this.layers.find((l) => l.id === id)
      || this.data.layers.find((l) => l.name === id)
      || [...this.carried.values()].find((c) => c.layer.name === id)?.layer
      || this.layers.find((l) => l.name === id);
  }

  /** Where an element comes from on this page. */
  layerOrigin(id: string): 'own' | 'carried' | 'global' | 'label' | null {
    const l = this.layer(id);
    if (!l) return null;
    if (this.globalIds.has(l.id)) return 'global';
    if (this.carried.has(l.id)) return 'carried';
    if (this.data.layers.includes(l)) return 'own';
    return 'label';
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
    if (this.globalIds.has(id)) this.rt.globals.visibleState.set(id, v);
  }

  /* ----------------------------------------------------------------- */
  /* Game module: order, pause, labels, collectibles                    */
  /* ----------------------------------------------------------------- */

  /** Bring an element in front of (or behind) everything else on the page. */
  reorder(layerId: string, to: 'front' | 'back'): void {
    const id = this.resolveLayer(layerId);
    this.zOrder = this.zOrder.filter((z) => z.id !== id);
    this.zOrder.push({ id, to });
    this.rebuildLayers();
  }

  /** Pause an element: its media, animations and frame playback stop where they are. */
  pauseElement(layerId: string): void {
    const id = this.resolveLayer(layerId);
    if (this.pausedLayers.has(id)) return;
    this.pausedLayers.add(id);
    this.instances.get(id)?.pause?.();
    for (const c of this.clips) if (c.tracks.some((t) => t.layerId === id)) this.anim.setPaused(c.id, true);
  }

  /** Resume a paused element (and the paused scripts that use it). Empty: everything paused on this page. */
  resumeElement(layerId: string | null): void {
    const ids = layerId ? [this.resolveLayer(layerId)] : [...this.pausedLayers];
    for (const id of ids) {
      const was = this.pausedLayers.delete(id);
      if (was) {
        const l = this.layer(id);
        if (l && (l.type === 'core.audio' || l.type === 'core.video')) this.instances.get(id)?.play?.();
        for (const c of this.clips) if (c.tracks.some((t) => t.layerId === id)) this.anim.setPaused(c.id, false);
      }
    }
    for (const st of this.allStacks) {
      if (!this.pausedScripts.has(st.id)) continue;
      if (layerId && !scriptElements(this.rt.engine, st).has(ids[0])) continue;
      this.resumeScript(st.id);
    }
  }

  resumeScript(stackId: string): void {
    if (!this.pausedScripts.delete(stackId)) return;
    const st = this.allStacks.find((x) => x.id === stackId);
    if (!st) return;
    const carried = this.carriedScripts.find((c) => c.stack.id === stackId);
    if (!this.scripts.setupStack(st) && carried?.running) this.scripts.spawn(st, null);
  }

  /** A "when the page changes, remove/pause" block ran. Empty element: this script (its elements follow it). */
  leaveRule(kind: 'remove' | 'pause', layerId: string | null, stackId: string): void {
    const remove = kind === 'remove';
    if (layerId) { (remove ? this.leave.removeLayers : this.leave.pauseLayers).add(this.resolveLayer(layerId)); return; }
    (remove ? this.leave.removeScripts : this.leave.pauseScripts).add(stackId);
  }

  /**
   * Show text at a position (a label). The same name updates the label. The value is
   * re-read every frame, so a label showing a variable follows it. Labels shown by
   * global scripts stay on every page.
   */
  showLabel(name: string, value: () => string, x: number, y: number, style: { fontSize?: number; color?: string; align?: string } = {}, global = false): void {
    const list = global ? this.rt.globals.labels : this.labels;
    const key = String(name || 'label');
    let l = list.find((x) => x.name === key);
    if (!l) {
      l = { id: newId('lbl'), type: 'core.text', name: key, parentId: null, visible: true, locked: true, props: {} };
      list.push(l);
    }
    const props = { ...Object.fromEntries(this.rt.engine.layerProps('core.text').map((d) => [d.key, d.default])), text: value(), x, y, anchorX: style.align === 'center' ? 0.5 : style.align === 'right' ? 1 : 0, anchorY: 0, fontSize: style.fontSize ?? 36, color: style.color ?? '#ffffff', align: style.align || 'left', strokeColor: 'rgba(0,0,0,0.75)', strokeWidth: 4 };
    l.props = props;
    this.layerState.set(l.id, { ...props });
    this.visibleState.set(l.id, true);
    this.labelValues.set(l.id, value);
    if (global) this.rt.globals.labelValues.set(l.id, value);
    this.rebuildLayers();
  }

  hideLabel(name: string | null): void {
    for (const list of [this.labels, this.rt.globals.labels]) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (name && list[i].name !== String(name)) continue;
        this.labelValues.delete(list[i].id);
        this.rt.globals.labelValues.delete(list[i].id);
        this.layerState.delete(list[i].id);
        list.splice(i, 1);
      }
    }
    this.rebuildLayers();
  }

  /** Pick up an element as a collectible: it disappears (also when the page is visited again) and the item goes to the inventory. */
  pickUp(layerId: string, item: string | null): void {
    const id = this.resolveLayer(layerId);
    const l = this.layer(id)!;
    this.setVisible(id, false);
    const origin = this.carried.get(id)?.from || this.node.id;
    if (!this.globalIds.has(id)) this.rt.items.collected.add(`${origin}:${id}`);
    this.rt.items.add(item || l.name);
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
    for (const [id, fn] of [...this.labelValues, ...this.rt.globals.labelValues]) {
      const st = this.layerState.get(id);
      if (!st) continue;
      try { st.text = fn(); } catch { /* keep the last text */ }
    }
    const stepCtx = { emit: (e: RuntimeEvent) => this.dispatch(e), runtime: this.rt.api };
    for (const l of this.layers) {
      if (this.pausedLayers.has(l.id)) continue;
      const def = this.rt.engine.layerTypes.get(l.type);
      if (!def?.step) continue;
      const st = this.layerState.get(l.id);
      if (!st) continue;
      try { def.step(st, dt, { ...stepCtx, layer: l }); } catch (err) { this.rt.reportError(`layer:${l.type}`, err, { layerId: l.id }); }
    }
    for (const l of this.layers) {
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
    if (l.type === CHOICE_LAYER) return this.offered.has(l.id) && !this.offered.get(l.id)!.disabled;
    if (l.type === 'core.button' || l.type === 'core.hotspot') return true;
    if (this.rt.engine.layerTypes.get(l.type)?.interactive) return true;
    if (this.rt.items.selected && this.scripts.listens('item.used', (a) => !a.layer || a.layer === l.id)) return true;
    return this.scripts.listens('layer.click', (a) => a.layer === l.id) || this.scripts.listens('layer.hoverEnter', (a) => a.layer === l.id);
  }

  /** Returns true if the click was consumed by an interactive layer. */
  pointerDown(x: number, y: number): boolean {
    if (this.exited) return true;
    const hit = hitTest(this.view, x, y, (l) => this.isInteractive(l));
    if (!hit) return false;
    if (hit.type === CHOICE_LAYER) { this.pickChoice(hit.id); return true; }
    if (hit.type === 'core.button' && this.layerState.get(hit.id)?.enabled === false) return true;
    const def = this.rt.engine.layerTypes.get(hit.type);
    if (def?.pointer) {
      const lp = layerLocalPoint(this.view, hit, x, y);
      try { if (lp && def.pointer(hit, this.view.props(hit), lp.x, lp.y, lp.size, { emit: (e) => this.dispatch(e), runtime: this.rt.api })) { this.dispatch({ type: 'layer.click', layerId: hit.id }); return true; } }
      catch (err) { this.rt.reportError(`layer:${hit.type}`, err, { layerId: hit.id }); }
    }
    // Using the selected item on an element.
    const item = this.rt.items.selected;
    if (item && this.scripts.listens('item.used', (a) => !a.layer || a.layer === hit.id)) {
      this.dispatch({ type: 'item.used', item, layerId: hit.id });
      return true;
    }
    this.dispatch({ type: 'layer.click', layerId: hit.id });
    return true;
  }

  /* ----------------------------------------------------------------- */
  /* Sensing (used by blocks and modules)                               */
  /* ----------------------------------------------------------------- */

  private timerStart = 0;
  /** Seconds since the scene started or the timer was reset. */
  get timer(): number { return Math.max(0, this.time - this.timerStart); }
  resetTimer(): void { this.timerStart = this.time; }

  /** Is the element shown (its own visibility and its groups')? */
  isVisible(layerId: string): boolean {
    const l = this.layer(layerId);
    return !!l && effectiveVisible(this.view, l);
  }

  /** Is the stage point (default: the mouse) inside the element's shape? Hidden elements contain nothing. */
  contains(layerId: string, x = this.rt.input.x, y = this.rt.input.y): boolean {
    const l = this.layer(layerId);
    if (!l || !effectiveVisible(this.view, l)) return false;
    if (this.rt.engine.layerTypes.get(l.type)?.visual === false) return false;
    return layerContains(this.view, l, x, y);
  }

  /** Stage-space bounding box of an element. */
  bounds(layerId: string): { x: number; y: number; width: number; height: number } | null {
    const l = this.layer(layerId);
    return l ? layerBounds(this.view, l) : null;
  }

  /** Do two visible elements' bounding boxes overlap? */
  touching(a: string, b: string): boolean {
    if (!this.isVisible(a) || !this.isVisible(b)) return false;
    const p = this.bounds(a), q = this.bounds(b);
    return !!p && !!q && p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
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
