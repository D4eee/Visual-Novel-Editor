import type { Engine, Project, StoryNode, SceneData, EndingData, Block, Expr, VarValue } from '@vne/core';
import { Emitter, evaluate, evaluateBool, builtinFunctions, I18n, ExprFunction, isExpr } from '@vne/core';
import { AssetLoader, AudioManager, AssetUrlResolver } from './assets';
import { Stage } from './stage';
import { NarrativeUI } from './narrative';
import { VarStore } from './state';
import { ScenePlayer } from './scene';
import type { Carry } from './scene';
import { CancelToken, ScriptEngine, ScriptHost, RuntimeEvent } from './script';
import { CanvasPool, ShaderRunner, makeCanvas, ctx2d, Canvas } from './effects';
import { drawScene } from './render';
import { SystemUI } from './ui';
import { runtimeStrings } from './strings';
import { GlobalPage, Items } from './globals';
import { resolveFontFamily } from './assets';
import { spriteFrames } from './builtins/layers';

export interface GameOptions {
  project: Project;
  engine: Engine;
  container: HTMLElement;
  resolveAssetUrl: AssetUrlResolver;
  mode: 'game' | 'preview';
  /** Namespace for saves/settings in localStorage. Defaults to the project id. */
  storageKey?: string;
  locale?: string;
  onQuit?: () => void;
  /** Called for every runtime diagnostic. */
  onError?: (e: RuntimeError) => void;
}

export interface RuntimeError { source: string; message: string; moduleId?: string; nodeId?: string; time: number; detail?: Record<string, any> }

export interface DebugEvents {
  node: { nodeId: string; type: string; name: string };
  event: RuntimeEvent & { time: number };
  error: RuntimeError;
  var: { id: string; name: string; value: VarValue };
  state: { running: boolean };
  log: { message: string; time: number };
  /** A script block started running (hats report their own id when they fire). */
  block: { blockId: string; nodeId: string | null };
}

export interface SaveData {
  v: 1;
  projectId: string;
  time: string;
  nodeId: string;
  nodeName: string;
  lineIndex: number;
  vars: Record<string, VarValue>;
  visited: string[];
  music: string | null;
  systems: Record<string, unknown>;
  thumb?: string;
  text?: string;
  /** Game module: global elements' state, picked-up elements, the selected item. */
  game?: { globals?: { state?: Record<string, Record<string, any>>; visible?: Record<string, boolean> }; collected?: string[]; selected?: string | null };
}

export interface PlayerSettings {
  textSpeed: number;
  autoDelay: number;
  volumes: { master: number; bgm: number; sfx: number; voice: number; ambient: number };
  fullscreen: boolean;
  locale: string;
}

interface Timer { at: number; resolve: () => void; token?: CancelToken }

/**
 * The game runtime. The editor preview and exported games both run this class,
 * so story execution, scenes, animation, scripts, effects and modules behave
 * identically in both.
 */
export class GameRuntime {
  readonly engine: Engine;
  readonly project: Project;
  readonly assets: AssetLoader;
  readonly audio: AudioManager;
  readonly vars: VarStore;
  readonly stage: Stage;
  readonly narrative: NarrativeUI;
  readonly hud: HTMLDivElement;
  readonly pool = new CanvasPool();
  readonly shaders = new ShaderRunner();
  readonly debug = new Emitter<DebugEvents>();
  readonly events = new Emitter<Record<string, any>>();
  readonly i18n: I18n;
  readonly functions: Record<string, ExprFunction>;
  readonly ui: SystemUI;
  settings: { textSpeed: number; autoDelay: number };
  playerSettings: PlayerSettings;
  scene: ScenePlayer | null = null;
  /** The global page's elements (shared by every page). */
  readonly globals: GlobalPage;
  /** The player's collectibles. */
  readonly items: Items;
  currentNodeId: string | null = null;
  path: string[] = [];
  visited = new Set<string>();
  backlog: { kind: 'line' | 'choice'; name: string; text: string; nodeId: string }[] = [];
  autoMode = false;
  skipMode = false;
  paused = false;
  errors: RuntimeError[] = [];
  readonly systems = new Map<string, any>();
  readonly api: any;

  private clock = 0;
  private timers: Timer[] = [];
  private frameWaiters: { resolve: () => void; token?: CancelToken }[] = [];
  private raf = 0;
  private last = 0;
  private storyToken: CancelToken | null = null;
  private pendingGoto: string | null = null;
  private sceneCanvas: Canvas;
  private transition: { from: Canvas; start: number; dur: number; type: string; params: Record<string, any> } | null = null;
  private shakeFx: { until: number; intensity: number; start: number } | null = null;
  private flashEl: HTMLDivElement;
  private disposed = false;
  /** Pointer and keyboard state for sensing blocks (mouse x/y in stage pixels). */
  readonly input = { x: 0, y: 0, down: false, keys: new Set<string>() };
  private pointerUpHandler = () => { this.input.down = false; };
  private blurHandler = () => { this.input.down = false; this.input.keys.clear(); };
  private keyHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;
  private storageKey: string;

  constructor(readonly opts: GameOptions) {
    this.engine = opts.engine;
    this.project = opts.project;
    this.storageKey = `vne:${opts.storageKey || opts.project.id}`;
    this.functions = this.engine.functionTable(builtinFunctions);
    this.globals = new GlobalPage(this);
    this.items = new Items(this);
    this.functions.has = { id: 'has', label: 'has', args: 1, fn: (x) => this.items.has(x) };
    this.i18n = new I18n(opts.locale || 'en');
    for (const [loc, dict] of Object.entries(runtimeStrings)) this.i18n.add(loc, dict);
    this.assets = new AssetLoader(() => this.project, opts.resolveAssetUrl);
    this.assets.loadFonts();
    this.audio = new AudioManager(this.assets);
    this.vars = new VarStore(() => this.project, `${this.storageKey}:persistent`);
    this.vars.events.on('change', (c) => this.debug.emit('var', { id: c.id, name: c.name, value: c.value }));
    const { width, height } = this.project.settings.resolution;
    this.stage = new Stage(opts.container, width, height, { fit: 'contain' });
    this.sceneCanvas = makeCanvas(width, height);
    this.narrative = new NarrativeUI(this.stage.overlay);
    this.narrative.applyStyle({ ...this.project.settings.textbox, fontFamily: resolveFontFamily(this.project, this.project.settings.textbox.fontFamily) });
    this.hud = document.createElement('div');
    this.hud.className = 'vne-hud';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'vne-flash';
    this.stage.overlay.append(this.flashEl, this.hud);
    this.playerSettings = this.loadSettings();
    this.i18n.setLocale(this.playerSettings.locale);
    this.settings = { textSpeed: this.playerSettings.textSpeed, autoDelay: this.playerSettings.autoDelay };
    this.audio.setVolumes(this.playerSettings.volumes);

    this.api = this.createApi();
    this.ui = new SystemUI(this);

    this.stage.overlay.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.stage.overlay.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.stage.overlay.addEventListener('wheel', (e) => { if (e.deltaY < 0 && !this.ui.isOpen) this.ui.open('log'); }, { passive: true });
    this.keyHandler = (e) => this.onKey(e);
    this.keyUpHandler = (e) => { this.input.keys.delete(e.code); if (e.key === 'Control') this.skipMode = false; };
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('pointerup', this.pointerUpHandler);
    window.addEventListener('blur', this.blurHandler);
    window.addEventListener('keyup', this.keyUpHandler);

    this.createSystems();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /* ----------------------------------------------------------------- */
  /* Public API exposed to modules (documented in docs/api/runtime.md)  */
  /* ----------------------------------------------------------------- */

  private createApi() {
    const rt = this;
    return {
      engine: this.engine,
      project: this.project,
      vars: this.vars,
      audio: this.audio,
      events: this.events,
      hud: this.hud,
      i18n: this.i18n,
      mode: this.opts.mode,
      get scene() { return rt.scene; },
      /** Collectibles: has/count/add/remove/select, the selected item and the inventory list. */
      items: {
        has: (k: unknown) => rt.items.has(k),
        count: (k: unknown) => rt.items.count(k),
        add: (k: unknown, n = 1) => rt.items.add(k, n),
        remove: (k: unknown, all = false) => rt.items.remove(k, all),
        select: (k: unknown | null) => rt.items.select(k),
        get selected() { return rt.items.selected; },
        list: (listVar: string | null = null) => rt.items.list(listVar),
      },
      get globals() { return rt.globals; },
      /** Mouse position (stage pixels), button and held keys. */
      get input() { return rt.input; },
      get currentNodeId() { return rt.currentNodeId; },
      get time() { return rt.clock; },
      system: (id: string) => rt.systems.get(id),
      gotoNode: (id: string) => rt.gotoNode(id),
      save: (slot: string) => rt.saveGame(slot),
      load: (slot: string) => rt.loadGame(slot),
      toast: (msg: string) => rt.ui.toast(msg),
      debugLog: (msg: string) => rt.debugLog(msg),
      evaluate: (e: Expr) => evaluate(e, rt.vars, rt.functions),
      sleep: (s: number) => rt.sleepPlain(s),
      stageToClient: () => ({ scale: rt.stage.scale }),
    };
  }

  private createSystems(): void {
    for (const def of this.engine.systems.list()) {
      try {
        this.systems.set(def.id, def.create(this.api));
      } catch (err) {
        this.reportError(`module:${def.owner}`, err);
      }
    }
  }

  /* ----------------------------------------------------------------- */
  /* Clock                                                              */
  /* ----------------------------------------------------------------- */

  /** Game-time sleep: stops while menus are open, cancellable. */
  sleep(seconds: number, token?: CancelToken): Promise<void> {
    return new Promise((resolve) => {
      const t: Timer = { at: this.clock + seconds, resolve, token };
      this.timers.push(t);
      token?.onCancel(() => { this.timers = this.timers.filter((x) => x !== t); resolve(); });
    });
  }

  sleepPlain(seconds: number): Promise<void> {
    return this.sleep(seconds);
  }

  nextFrame(token?: CancelToken): Promise<void> {
    return new Promise((resolve) => {
      const w = { resolve, token };
      this.frameWaiters.push(w);
      token?.onCancel(() => { this.frameWaiters = this.frameWaiters.filter((x) => x !== w); resolve(); });
    });
  }

  private frame(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused || this.ui.blocksGame) dt = 0;
    if (this.skipMode) dt *= 1; // skip shortens waits in the narrative loop instead of speeding the clock
    this.clock += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.clock);
      if (due.length) { this.timers = this.timers.filter((t) => t.at > this.clock); due.forEach((t) => t.resolve()); }
    }
    if (this.frameWaiters.length && dt > 0) { const w = this.frameWaiters; this.frameWaiters = []; w.forEach((x) => x.resolve()); }
    this.narrative.tick(dt);
    if (this.scene) {
      try { this.scene.update(dt); } catch (err) { this.reportError('scene', err); }
    }
    this.render();
    this.pool.releaseAll();
  }

  private render(): void {
    const { width, height } = this.project.settings.resolution;
    const pr = this.stage.pixelRatio;
    const sw = Math.round(width * pr), sh = Math.round(height * pr);
    if (this.sceneCanvas.width !== sw || this.sceneCanvas.height !== sh) { this.sceneCanvas.width = sw; this.sceneCanvas.height = sh; }
    const sctx = ctx2d(this.sceneCanvas);
    sctx.setTransform(pr, 0, 0, pr, 0, 0);
    if (this.scene) {
      try { drawScene(sctx, this.scene.view, this.scene.data.background || '#000'); }
      catch (err) { this.reportError('render', err); }
    } else {
      sctx.fillStyle = '#000';
      sctx.fillRect(0, 0, width, height);
    }
    const out = this.stage.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha = 1;
    out.globalCompositeOperation = 'source-over';
    let dx = 0, dy = 0;
    if (this.shakeFx) {
      if (this.clock >= this.shakeFx.until) this.shakeFx = null;
      else {
        const k = (this.shakeFx.until - this.clock) / Math.max(0.001, this.shakeFx.until - this.shakeFx.start);
        dx = (Math.random() - 0.5) * 2 * this.shakeFx.intensity * k * pr;
        dy = (Math.random() - 0.5) * 2 * this.shakeFx.intensity * k * pr;
      }
    }
    if (dx || dy) { out.fillStyle = '#000'; out.fillRect(0, 0, sw, sh); }
    if (this.transition) {
      const p = Math.min(1, (this.clock - this.transition.start) / Math.max(0.001, this.transition.dur));
      const def = this.engine.transitions.get(this.transition.type) || this.engine.transitions.get('dissolve');
      try {
        out.save();
        out.translate(dx, dy);
        if (this.transition.from.width !== sw) { out.drawImage(this.sceneCanvas as any, 0, 0); }
        else def!.draw(out, this.transition.from, this.sceneCanvas, p, this.transition.params);
        out.restore();
      } catch (err) {
        this.reportError(`transition:${this.transition.type}`, err);
        out.drawImage(this.sceneCanvas as any, dx, dy);
      }
      if (p >= 1) this.transition = null;
    } else {
      out.drawImage(this.sceneCanvas as any, dx, dy);
    }
  }

  /** A copy of the current frame (for transitions and save thumbnails). */
  snapshot(): Canvas {
    const c = makeCanvas(this.sceneCanvas.width, this.sceneCanvas.height);
    ctx2d(c).drawImage(this.stage.canvas, 0, 0);
    return c;
  }

  shake(intensity: number, seconds: number, token?: CancelToken): Promise<void> {
    this.shakeFx = { start: this.clock, until: this.clock + seconds, intensity };
    return this.sleep(seconds, token);
  }

  flash(color: string, seconds: number, token?: CancelToken): Promise<void> {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = '1';
    requestAnimationFrame(() => { el.style.transition = `opacity ${seconds}s ease-out`; el.style.opacity = '0'; });
    return this.sleep(seconds, token);
  }

  /* ----------------------------------------------------------------- */
  /* Story execution                                                    */
  /* ----------------------------------------------------------------- */

  /** Start for real players: title screen in game mode, straight in for preview. */
  start(startNodeId?: string | null): void {
    if (this.opts.mode === 'game') this.ui.showTitle();
    else this.startAt(startNodeId || this.startNode()?.id || '', 0, true);
  }

  startNode(): StoryNode | undefined {
    return Object.values(this.project.nodes).find((n) => n.type === 'core.start');
  }

  newGame(): void {
    this.vars.reset();
    this.resetGameState();
    this.backlog = [];
    this.visited.clear();
    this.path = [];
    const s = this.startNode();
    if (!s) { this.reportError('story', new Error('This project has no Start node.')); return; }
    this.startAt(s.id, 0, true);
  }

  /** Forget the global page's state and the picked-up elements (new game, back to title). */
  resetGameState(): void {
    this.scene?.dispose();
    this.scene = null;
    this.globals.reset();
    this.items.reset();
  }

  startAt(nodeId: string, resumeLine = 0, fresh = false): void {
    this.ui.hideTitle();
    if (fresh) {
      this.path = [];
      // A fresh start does not inherit from the page shown before.
      this.storyToken?.cancel();
      this.scene?.dispose();
      this.scene = null;
    }
    this.storyToken?.cancel();
    const token = new CancelToken();
    this.storyToken = token;
    this.debug.emit('state', { running: true });
    this.runStory(nodeId, resumeLine, token).catch((err) => this.reportError('story', err));
  }

  gotoNode(nodeId: string): void {
    if (!this.project.nodes[nodeId]) { this.reportError('story', new Error(`Node ${nodeId} does not exist`)); return; }
    this.pendingGoto = nodeId;
    if (this.scene && !this.scene.isExited) this.scene.exit('__goto');
  }

  private async runStory(fromId: string, resumeLine: number, token: CancelToken): Promise<void> {
    let id: string | null = fromId;
    let resume = resumeLine;
    let nonSceneSteps = 0;
    while (id && !token.cancelled && !this.disposed) {
      const node: StoryNode | undefined = this.project.nodes[id];
      if (!node) { this.reportError('story', new Error(`The story points to a node that does not exist (${id}).`)); break; }
      this.currentNodeId = id;
      this.path.push(id);
      if (this.path.length > 500) this.path.splice(0, this.path.length - 500);
      this.visited.add(id);
      this.debug.emit('node', { nodeId: id, type: node.type, name: node.name });
      const def = this.engine.nodeTypes.get(node.type);
      if (!def) { this.reportError('story', new Error(`Node "${node.name}" uses type "${node.type}", which is not installed.`), { nodeId: id }); await this.deadEnd(node, null); return; }
      if (!def.run) { this.reportError('story', new Error(`Node "${node.name}" (${node.type}) cannot be executed.`), { nodeId: id }); await this.deadEnd(node, null); return; }
      nonSceneSteps = node.type === 'core.scene' ? 0 : nonSceneSteps + 1;
      if (nonSceneSteps > 2000) { this.reportError('story', new Error('The story looped 2000 times without showing a scene. Check for a loop of logic nodes.'), { nodeId: id }); return; }

      let result: any;
      try {
        let override: string | null = null;
        if (node.type !== 'core.scene') override = await this.runNodeComponents(node);
        result = override ?? (await def.run(node, this.storyContext(node, resume, token)));
      } catch (err) {
        this.reportError(def.owner && def.owner !== 'core' ? `module:${def.owner}` : 'story', err, { nodeId: id });
        await this.deadEnd(node, null, true);
        return;
      }
      resume = 0;
      if (token.cancelled) return;
      if (this.pendingGoto) { id = this.pendingGoto; this.pendingGoto = null; continue; }
      if (result === null || result === undefined || (typeof result === 'object' && result.end)) { this.debug.emit('state', { running: false }); return; }
      if (typeof result === 'object' && result.goto) { id = result.goto; continue; }
      const port = String(result);
      const edge = this.project.edges.find((e) => e.from.node === node.id && e.from.port === port);
      if (!edge) { await this.deadEnd(node, port); return; }
      id = edge.to.node;
    }
  }

  private async runNodeComponents(node: StoryNode): Promise<string | null> {
    for (const inst of node.modules || []) {
      if (!inst.enabled) continue;
      const def = this.engine.components.get(inst.component);
      if (!def?.nodeRun) continue;
      try {
        const r = await def.nodeRun({ runtime: this.api, vars: this.vars, data: inst.data, node, overlay: this.hud }, inst.data, {});
        if (typeof r === 'string') return r;
      } catch (err) {
        this.reportError(`module:${inst.moduleId}`, err, { nodeId: node.id });
      }
    }
    return null;
  }

  private storyContext(node: StoryNode, resume: number, token: CancelToken) {
    const rt = this;
    return {
      runtime: this.api,
      project: this.project,
      vars: this.vars,
      token,
      playScene: (n: StoryNode) => rt.playScene(n as StoryNode<SceneData>, resume, token),
      runActions: (blocks: Block[], id?: string) => rt.runActions(blocks, id || node.id),
      evaluate: (e: Expr | null) => evaluate(e, rt.vars, rt.functions),
      evaluateBool: (e: Expr | null) => evaluateBool(e, rt.vars, rt.functions),
      sleep: (s: number) => rt.sleep(s, token),
      random: () => Math.random(),
      ending: (d: EndingData) => rt.showEnding(d),
      warn: (msg: string) => rt.reportError('story', new Error(msg), { nodeId: node.id, severity: 'warning' }),
      input: async (port: string) => rt.pullInput(node, port),
    };
  }

  /** Pull a value from a data input port (data connections are evaluated lazily). */
  async pullInput(node: StoryNode, port: string, depth = 0): Promise<VarValue | undefined> {
    if (depth > 64) throw new Error('Data connection cycle');
    const edge = this.project.edges.find((e) => e.to.node === node.id && e.to.port === port);
    if (!edge) return undefined;
    const src = this.project.nodes[edge.from.node];
    const def = src && this.engine.nodeTypes.get(src.type);
    if (!def?.evaluate) return undefined;
    return def.evaluate(src, edge.from.port, { ...this.storyContext(src, 0, this.storyToken || new CancelToken()), input: (p: string) => this.pullInput(src, p, depth + 1) });
  }

  private actionHost(): ScriptHost {
    return {
      engine: this.engine, project: this.project, vars: this.vars, scene: this.scene, runtime: this.api, functions: this.functions,
      sleep: (s, tok) => this.sleep(s, tok),
      nextFrame: (tok) => this.nextFrame(tok),
      emit: (e) => { if (this.scene) this.scene.dispatch(e); else this.debugEvent(e); },
      reportError: (source, err, extra) => this.reportError(source, err, extra),
    };
  }

  async runActions(blocks: Block[], id: string): Promise<void> {
    const engine = new ScriptEngine(this.actionHost(), () => []);
    await engine.runOnce(blocks, id);
  }

  private async playScene(node: StoryNode<SceneData>, resume: number, token: CancelToken): Promise<string> {
    const prev = this.scene;
    const tr = node.data.transition || this.project.settings.defaultTransition;
    const from = prev ? this.snapshot() : null;
    // What is still running on the last page continues on this one.
    let carry: Carry | null = null;
    try { carry = prev ? prev.handOff(node) : null; } catch (err) { this.reportError('scene', err, { nodeId: prev?.node.id }); }
    prev?.dispose();
    const player = new ScenePlayer(this, node, resume, carry);
    this.scene = player;
    // preload images used by the scene before showing it (avoids pop-in during transitions)
    const ids: string[] = [];
    for (const l of player.layers) {
      if (l.props.assetId) ids.push(l.props.assetId);
      for (const f of spriteFrames(l.props)) if (f.assetId) ids.push(f.assetId);
    }
    for (const it of this.project.items) if (it.assetId) ids.push(it.assetId);
    await this.assets.preloadImages([...new Set(ids)]);
    if (token.cancelled) return '__cancelled';
    if (from && tr && tr.type !== 'none' && tr.duration > 0 && !this.skipMode) {
      this.transition = { from, start: this.clock, dur: tr.duration, type: tr.type, params: tr.params || {} };
    }
    this.autosave(node);
    const port = await player.play();
    player.freeze();
    return port;
  }

  private async deadEnd(node: StoryNode, port: string | null, error = false): Promise<void> {
    if (port !== null) {
      const def = this.engine.nodeTypes.get(node.type);
      const label = def?.outputs(node, this.project).find((p) => p.id === port)?.label || port;
      this.reportError('story', new Error(`The story stops at "${node.name}": output "${label}" is not connected.`), { nodeId: node.id, severity: 'warning' });
    }
    this.debug.emit('state', { running: false });
    await this.showEnding({ label: error ? this.i18n.t('rt.error') : this.i18n.t('rt.end'), behavior: 'title', message: error ? this.i18n.t('rt.errorMsg') : '', unlockVarId: null });
  }

  async showEnding(d: EndingData): Promise<void> {
    if (d.unlockVarId) this.vars.set(d.unlockVarId, true);
    this.narrative.setBoxVisible(false);
    this.narrative.hideChoices();
    await this.ui.showEnding(d.label, d.message);
    if (this.opts.mode === 'preview') return;
    if (d.behavior === 'restart') this.newGame();
    else if (d.behavior === 'quit' && this.opts.onQuit) this.opts.onQuit();
    else this.toTitle();
  }

  toTitle(): void {
    this.storyToken?.cancel();
    this.resetGameState();
    this.audio.stopMusic();
    this.audio.stopSounds();
    this.narrative.setBoxVisible(false);
    this.narrative.hideChoices();
    if (this.opts.mode === 'game') this.ui.showTitle();
  }

  /* ----------------------------------------------------------------- */
  /* Saves                                                              */
  /* ----------------------------------------------------------------- */

  private saveKey(slot: string) { return `${this.storageKey}:save:${slot}`; }

  saveGame(slot: string): SaveData | null {
    if (!this.currentNodeId) return null;
    const node = this.project.nodes[this.currentNodeId];
    const systems: Record<string, unknown> = {};
    for (const [id, s] of this.systems) if (s?.save) try { systems[id] = s.save(); } catch (err) { this.reportError('save', err); }
    let thumb: string | undefined;
    try {
      const t = makeCanvas(320, 180) as HTMLCanvasElement;
      ctx2d(t).drawImage(this.stage.canvas, 0, 0, 320, 180);
      thumb = t.toDataURL('image/jpeg', 0.7);
    } catch { /* tainted canvas or unsupported */ }
    const last = [...this.backlog].reverse().find((b) => b.kind === 'line');
    const data: SaveData = {
      v: 1, projectId: this.project.id, time: new Date().toISOString(), nodeId: this.currentNodeId, nodeName: node?.name || '',
      lineIndex: this.scene && this.scene.node.id === this.currentNodeId ? this.scene.lineIndex : 0,
      vars: this.vars.snapshot(), visited: [...this.visited], music: this.audio.musicAssetId, systems, thumb, text: last ? `${last.name ? last.name + ': ' : ''}${last.text}`.slice(0, 120) : '',
      game: { globals: this.globals.snapshot(), collected: [...this.items.collected], selected: this.items.selected },
    };
    try { localStorage.setItem(this.saveKey(slot), JSON.stringify(data)); }
    catch (err) { this.reportError('save', err); return null; }
    return data;
  }

  readSave(slot: string): SaveData | null {
    try {
      const raw = localStorage.getItem(this.saveKey(slot));
      return raw ? (JSON.parse(raw) as SaveData) : null;
    } catch { return null; }
  }

  loadGame(slot: string): boolean {
    const s = this.readSave(slot);
    if (!s || !this.project.nodes[s.nodeId]) { this.ui.toast(this.i18n.t('rt.loadFailed')); return false; }
    this.vars.restore(s.vars);
    this.visited = new Set(s.visited);
    this.resetGameState();
    this.globals.restore(s.game?.globals);
    for (const k of s.game?.collected || []) this.items.collected.add(k);
    this.items.selected = s.game?.selected ?? null;
    for (const [id, data] of Object.entries(s.systems || {})) { const sys = this.systems.get(id); if (sys?.load) try { sys.load(data); } catch (err) { this.reportError('load', err); } }
    if (s.music) this.audio.playMusic(s.music); else this.audio.stopMusic();
    this.backlog = [];
    this.ui.closeAll();
    this.startAt(s.nodeId, s.lineIndex, true);
    return true;
  }

  private autosave(node: StoryNode): void {
    if (this.opts.mode !== 'game') return;
    this.currentNodeId = node.id;
    setTimeout(() => this.saveGame('auto'), 50);
  }

  /* ----------------------------------------------------------------- */
  /* Settings                                                           */
  /* ----------------------------------------------------------------- */

  private loadSettings(): PlayerSettings {
    const defaults: PlayerSettings = {
      textSpeed: this.project.settings.textSpeed,
      autoDelay: this.project.settings.autoAdvanceDelay,
      volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1, ambient: 0.8 },
      fullscreen: this.project.settings.window.mode === 'fullscreen',
      locale: this.opts.locale || (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh-CN' : 'en'),
    };
    if (this.opts.mode === 'preview') return defaults;
    try {
      const raw = localStorage.getItem(`${this.storageKey}:settings`);
      if (raw) return { ...defaults, ...JSON.parse(raw), volumes: { ...defaults.volumes, ...(JSON.parse(raw).volumes || {}) } };
    } catch { /* ignore */ }
    return defaults;
  }

  updateSettings(patch: Partial<PlayerSettings>): void {
    this.playerSettings = { ...this.playerSettings, ...patch, volumes: { ...this.playerSettings.volumes, ...(patch.volumes || {}) } };
    this.settings.textSpeed = this.playerSettings.textSpeed;
    this.settings.autoDelay = this.playerSettings.autoDelay;
    this.audio.setVolumes(this.playerSettings.volumes);
    if (patch.locale) this.i18n.setLocale(patch.locale);
    if (this.opts.mode === 'game') try { localStorage.setItem(`${this.storageKey}:settings`, JSON.stringify(this.playerSettings)); } catch { /* ignore */ }
  }

  /* ----------------------------------------------------------------- */
  /* Input                                                              */
  /* ----------------------------------------------------------------- */

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 0) { const q = this.stage.toStage(e.clientX, e.clientY); this.input.x = q.x; this.input.y = q.y; this.input.down = true; }
    if (e.button !== 0 || this.ui.isOpen || this.transition) return;
    const p = this.stage.toStage(e.clientX, e.clientY);
    if (this.scene && !this.scene.isExited) {
      // Clicks on the text box (or other runtime UI) advance the story; they never reach layers underneath.
      const onUi = (e.target as HTMLElement | null)?.closest?.('.vne-textbox, .vne-quick, .vne-hud > *');
      if (!onUi && this.scene.pointerDown(p.x, p.y)) return;
      if (this.scene.choicesOpen) return;
      if (this.autoMode) { this.autoMode = false; this.ui.refreshQuick(); }
      this.scene.advance();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.stage.toStage(e.clientX, e.clientY);
    this.input.x = p.x; this.input.y = p.y;
    if (!this.scene || this.ui.isOpen) return;
    if ((e.target as HTMLElement | null)?.closest?.('.vne-textbox')) { this.stage.overlay.style.cursor = ''; return; }
    this.stage.overlay.style.cursor = this.scene.pointerMove(p.x, p.y);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.disposed) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (!this.stage.wrap.isConnected) return;
    if (this.opts.mode === 'preview' && !this.stage.container.closest('[data-preview-focus="true"]')) return;
    if (!e.repeat) this.input.keys.add(e.code);
    if (e.key === 'Escape') { if (this.ui.isOpen) this.ui.closeAll(); else if (this.opts.mode === 'game' && !this.ui.titleVisible) this.ui.open('menu'); e.preventDefault(); return; }
    if (this.ui.isOpen || !this.scene) return;
    if (e.key === 'Control') { this.skipMode = true; this.scene.advance(); return; }
    if (this.scene.key(e.code)) return;
    if (this.scene.choicesOpen && /^[1-9]$/.test(e.key)) { this.scene.pickChoiceByIndex(Number(e.key) - 1); e.preventDefault(); return; }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.scene.advance(); }
  }

  /* ----------------------------------------------------------------- */
  /* Diagnostics                                                        */
  /* ----------------------------------------------------------------- */

  reportError(source: string, err: unknown, detail: Record<string, any> = {}): void {
    const message = err instanceof Error ? err.message : String(err);
    const moduleId = source.startsWith('module:') ? source.slice(7) : undefined;
    const e: RuntimeError = { source, message, moduleId, nodeId: detail.nodeId, time: this.clock, detail };
    this.errors.push(e);
    if (this.errors.length > 200) this.errors.shift();
    if (detail.severity !== 'warning') console.error(`[vne:${source}]`, err);
    else console.warn(`[vne:${source}]`, message);
    this.debug.emit('error', e);
    this.opts.onError?.(e);
  }

  debugEvent(e: RuntimeEvent): void {
    this.debug.emit('event', { ...e, time: this.clock });
  }

  debugLog(message: string): void {
    this.debug.emit('log', { message, time: this.clock });
    console.log('[vne:log]', message);
  }

  backlogPush(entry: { kind: 'line' | 'choice'; name: string; text: string; nodeId: string }): void {
    this.backlog.push(entry);
    if (this.backlog.length > 300) this.backlog.shift();
  }

  playVoice(assetId: string): void {
    this.audio.playSound(assetId, 1, 'voice');
  }

  /** Evaluate an expression or literal against the current state. */
  value(v: any): VarValue {
    return isExpr(v) ? evaluate(v, this.vars, this.functions) : v;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.storyToken?.cancel();
    this.scene?.dispose();
    this.scene = null;
    for (const [id, s] of this.systems) try { s?.dispose?.(); } catch (err) { console.error(id, err); }
    this.audio.dispose();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('pointerup', this.pointerUpHandler);
    window.removeEventListener('blur', this.blurHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    this.ui.dispose();
    this.narrative.dispose();
    this.stage.dispose();
    this.events.clear();
    this.debug.clear();
  }
}
