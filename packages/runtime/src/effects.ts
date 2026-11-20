import type { Engine, EffectGraph, EffectNodeDef, VarScope } from '@vne/core';

export type Canvas = HTMLCanvasElement | OffscreenCanvas;

/** Canvas pool so effect graphs do not allocate every frame. */
export class CanvasPool {
  private free: Canvas[] = [];
  private used: Canvas[] = [];

  acquire(w: number, h: number): Canvas {
    w = Math.max(1, Math.ceil(w));
    h = Math.max(1, Math.ceil(h));
    let c = this.free.pop();
    if (!c) c = makeCanvas(w, h);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    else {
      // A reused canvas keeps its 2D state: reset it so the next user starts clean
      // (a leftover "destination-in" or filter would silently erase what is drawn).
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.filter = 'none';
      g.shadowBlur = 0;
      g.shadowColor = 'rgba(0,0,0,0)';
      g.imageSmoothingEnabled = true;
      g.clearRect(0, 0, w, h);
    }
    this.used.push(c);
    return c;
  }

  releaseAll(): void {
    this.free.push(...this.used);
    this.used = [];
    if (this.free.length > 48) this.free.length = 48;
  }
}

export function makeCanvas(w: number, h: number): Canvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function ctx2d(c: Canvas): CanvasRenderingContext2D {
  return c.getContext('2d') as CanvasRenderingContext2D;
}

/* ------------------------------------------------------------------ */
/* WebGL fragment-shader passes                                          */
/* ------------------------------------------------------------------ */

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

export interface ShaderUniforms { [name: string]: number | [number, number] | [number, number, number] | [number, number, number, number] }

/**
 * Runs GLSL ES 1.0 fragment shaders over canvases. Shaders receive
 * `sampler2D u_image`, `vec2 u_size`, `float u_time`, `varying vec2 uv` plus custom uniforms.
 */
export class ShaderRunner {
  private gl: WebGLRenderingContext | null = null;
  private canvas: Canvas | null = null;
  private programs = new Map<string, { prog: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> } | { error: string }>();
  private tex: WebGLTexture | null = null;
  private tex2: WebGLTexture | null = null;
  supported = true;
  lastError: string | null = null;

  private init(): WebGLRenderingContext | null {
    if (this.gl) return this.gl;
    if (!this.supported) return null;
    try {
      this.canvas = makeCanvas(2, 2);
      const gl = (this.canvas as any).getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGLRenderingContext | null;
      if (!gl) { this.supported = false; return null; }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      this.tex = gl.createTexture();
      this.tex2 = gl.createTexture();
      for (const t of [this.tex, this.tex2]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.gl = gl;
      return gl;
    } catch {
      this.supported = false;
      return null;
    }
  }

  private program(gl: WebGLRenderingContext, frag: string) {
    const cached = this.programs.get(frag);
    if (cached) return cached;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile error');
      return s;
    };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `precision mediump float;\nvarying vec2 uv;\nuniform sampler2D u_image;\nuniform sampler2D u_image2;\nuniform vec2 u_size;\nuniform float u_time;\n${frag}`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
      const entry = { prog, locs: new Map<string, WebGLUniformLocation | null>() };
      this.programs.set(frag, entry);
      return entry;
    } catch (err: any) {
      const entry = { error: String(err?.message || err) };
      this.programs.set(frag, entry);
      return entry;
    }
  }

  /** Run a fragment shader; returns a 2D canvas from the pool, or the input unchanged if WebGL is unavailable. */
  run(pool: CanvasPool, frag: string, input: Canvas, uniforms: ShaderUniforms = {}, time = 0, second?: Canvas | null): Canvas {
    const gl = this.init();
    if (!gl || !this.canvas) return input;
    const p = this.program(gl, frag);
    if ('error' in p) { this.lastError = p.error; return input; }
    const w = input.width, h = input.height;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    const loc = (n: string) => {
      if (!p.locs.has(n)) p.locs.set(n, gl.getUniformLocation(p.prog, n));
      return p.locs.get(n)!;
    };
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input as any);
    gl.uniform1i(loc('u_image'), 0);
    if (second) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.tex2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, second as any);
      gl.uniform1i(loc('u_image2'), 1);
    }
    gl.uniform2f(loc('u_size'), w, h);
    gl.uniform1f(loc('u_time'), time);
    for (const [k, v] of Object.entries(uniforms)) {
      const l = loc(k);
      if (!l) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    }
    const attr = gl.getAttribLocation(p.prog, 'p');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const out = pool.acquire(w, h);
    ctx2d(out).drawImage(this.canvas as any, 0, 0);
    return out;
  }

  compileError(frag: string): string | null {
    const gl = this.init();
    if (!gl) return 'WebGL is not available';
    const p = this.program(gl, frag);
    return 'error' in p ? p.error : null;
  }
}

/* ------------------------------------------------------------------ */
/* Graph evaluation                                                      */
/* ------------------------------------------------------------------ */

export interface EffectContext {
  engine: Engine;
  pool: CanvasPool;
  shaders: ShaderRunner;
  time: number;
  vars: VarScope;
  /** Live props of a layer in the same scene (for relationships between layers). */
  layerProps(layerId: string): Record<string, any> | undefined;
  /** Graph parameters (exposed as animatable "fx.<param>" properties). */
  params: Record<string, any>;
  /** The layer that owns the graph. */
  selfId: string;
  selfProps: Record<string, any>;
  width: number;
  height: number;
  errors: string[];
}

export interface EffectResult {
  image: Canvas | null;
  drives: { layerId: string; prop: string; value: any }[];
}

/**
 * Evaluates a typed effect graph. Values flow along edges from outputs to
 * inputs; unconnected inputs use the node's inline values. The image chain ends
 * at "fx.output"; "fx.drive" nodes write values to layer properties.
 */
export function evaluateEffectGraph(graph: EffectGraph, input: Canvas | null, ctx: EffectContext): EffectResult {
  const cache = new Map<string, Record<string, any>>();
  const visiting = new Set<string>();
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, { node: string; port: string }>();
  for (const e of graph.edges) incoming.set(`${e.to.node}:${e.to.port}`, e.from);
  const drives: EffectResult['drives'] = [];

  const evalNode = (id: string): Record<string, any> => {
    const hit = cache.get(id);
    if (hit) return hit;
    const node = nodes.get(id);
    if (!node) return {};
    if (visiting.has(id)) { ctx.errors.push(`cycle at ${node.type}`); return {}; }
    visiting.add(id);
    const def: EffectNodeDef | undefined = ctx.engine.effectNodes.get(node.type);
    let result: Record<string, any> = {};
    if (!def) {
      ctx.errors.push(`missing effect node "${node.type}"`);
      // pass the image through so a missing module does not blank the layer
      const src = incoming.get(`${id}:image`);
      result = { image: src ? evalNode(src.node)[src.port] : input };
    } else {
      const inputs: Record<string, any> = {};
      for (const p of def.inputs) {
        const src = incoming.get(`${id}:${p.id}`);
        if (src) inputs[p.id] = evalNode(src.node)[src.port];
        else inputs[p.id] = node.values?.[p.id] ?? p.default;
        if (inputs[p.id] === undefined && p.type === 'image') inputs[p.id] = null;
      }
      try {
        result = def.evaluate({ ...ctx, input, node, drive: (layerId: string, prop: string, value: any) => drives.push({ layerId: layerId || ctx.selfId, prop, value }) }, inputs, node) || {};
      } catch (err: any) {
        ctx.errors.push(`${def.label}: ${err?.message || err}`);
        result = { image: inputs.image ?? input };
      }
    }
    visiting.delete(id);
    cache.set(id, result);
    return result;
  };

  let image: Canvas | null = input;
  const outputNode = graph.nodes.find((n) => n.type === 'fx.output');
  if (outputNode) {
    const src = incoming.get(`${outputNode.id}:image`);
    image = src ? evalNode(src.node)[src.port] ?? input : input;
  }
  for (const n of graph.nodes) if (n.type === 'fx.drive' || ctx.engine.effectNodes.get(n.type)?.category === 'drive') evalNode(n.id);
  return { image, drives };
}

export function graphParamDefaults(graph: EffectGraph): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of graph.params) out[p.id] = p.default;
  return out;
}
