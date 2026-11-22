import { compileExpr, evalExpr, hashSeed } from './trackExpr';
import type { AnimationClip, Engine, Keyframe, PropDef, Track } from '@vne/core';
import { lerp, lerpColor } from './math';

export type PropKind = 'number' | 'color' | 'discrete';

export function propKind(def: PropDef | undefined, sample: any): PropKind {
  if (def) {
    if (def.type === 'number') return 'number';
    if (def.type === 'color') return 'color';
    return 'discrete';
  }
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'string' && /^(#|rgb)/.test(sample)) return 'color';
  return 'discrete';
}

/** Value of a track at time t (seconds), or undefined when the track has no keyframes. */
export function sampleTrack(engine: Engine, track: Track, t: number, kind: PropKind): any {
  const ks = track.keyframes;
  if (!ks.length) return undefined;
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  // binary search for the segment
  let lo = 0, hi = ks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ks[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = ks[lo], b = ks[hi];
  return interpolate(engine, a, b, (t - a.t) / Math.max(1e-9, b.t - a.t), kind);
}

export function interpolate(engine: Engine, a: Keyframe, b: Keyframe, u: number, kind: PropKind): any {
  const interp = engine.interpolators.get(a.ease) || engine.interpolators.get('linear');
  if (!interp || interp.discrete || kind === 'discrete') return u >= 1 ? b.v : a.v;
  let e = u;
  try {
    e = interp.ease(u, a);
  } catch (err) {
    console.error('[vne] interpolator failed', a.ease, err);
  }
  if (kind === 'color') return lerpColor(a.v, b.v, e);
  return lerp(Number(a.v) || 0, Number(b.v) || 0, e);
}

/** Sample every track of a clip. Returns layerId → { prop: value }. */
/** Finds an element by id or name (for expressions): its id and its current properties. */
export type LayerLookup = (nameOrId: string) => { id: string; props: Record<string, any> } | undefined;

export function sampleClip(engine: Engine, clip: AnimationClip, t: number, propDef: (layerId: string, prop: string) => PropDef | undefined, out: Map<string, Record<string, any>> = new Map(), lookup?: LayerLookup): Map<string, Record<string, any>> {
  let withExpr: Track[] | null = null;
  for (const track of clip.tracks) {
    if (track.expr) (withExpr ||= []).push(track);
    const def = propDef(track.layerId, track.prop);
    const v = sampleTrack(engine, track, t, propKind(def, track.keyframes[0]?.v));
    if (v === undefined) continue;
    let rec = out.get(track.layerId);
    if (!rec) out.set(track.layerId, (rec = {}));
    rec[track.prop] = v;
  }
  // Expressions run after the keys, so they can use the keyed value (and other elements' tracks).
  if (withExpr) for (const track of withExpr) {
    const v = trackExprValue(engine, clip, track, t, propDef, lookup, 0);
    if (v === undefined) continue;
    let rec = out.get(track.layerId);
    if (!rec) out.set(track.layerId, (rec = {}));
    rec[track.prop] = v;
  }
  // In/out points: outside its span an element is not drawn (the special "__span" value).
  if (clip.spans) for (const [layerId, sp] of Object.entries(clip.spans)) {
    if (!sp) continue;
    let rec = out.get(layerId);
    if (!rec) out.set(layerId, (rec = {}));
    rec.__span = t >= (sp.in || 0) - 1e-6 && (sp.out == null || t < sp.out - 1e-6);
  }
  return out;
}

/** The value of an expression track at time t (undefined when the expression does not compile). */
export function trackExprValue(engine: Engine, clip: AnimationClip, track: Track, t: number, propDef: (layerId: string, prop: string) => PropDef | undefined, lookup: LayerLookup | undefined, depth: number): any {
  const c = compileExpr(track.expr || '');
  if (!c.ast) return undefined;
  const kind = propKind(propDef(track.layerId, track.prop), track.keyframes[0]?.v);
  const keyed = (time: number) => (track.keyframes.length ? sampleTrack(engine, track, Math.max(0, time), kind) : lookup?.(track.layerId)?.props[track.prop]);
  const value = keyed(t);
  let r: any;
  try {
    r = evalExpr(c.ast, {
      time: t, value, prop: track.prop, seed: hashSeed(track.layerId + track.prop), valueAt: keyed,
      keyEnd: track.keyframes.length ? track.keyframes[track.keyframes.length - 1].t : 0,
      follow: (target, prop, at) => {
        const l = lookup?.(target);
        if (!l) return value;
        const other = clip.tracks.find((x) => x.layerId === l.id && x.prop === prop);
        if (other?.expr && depth < 4 && other !== track) { const v = trackExprValue(engine, clip, other, Math.max(0, at), propDef, lookup, depth + 1); if (v !== undefined) return v; }
        if (other && other.keyframes.length) return sampleTrack(engine, other, Math.max(0, at), propKind(propDef(l.id, prop), other.keyframes[0]?.v));
        return l.props[prop];
      },
    });
  } catch { return value; }
  if (kind === 'number') { const x = Number(r); return Number.isFinite(x) ? x : value; }
  return r === undefined ? value : r;
}

/** Sort keyframes and keep at most one keyframe per time (later wins). Mutates the draft track. */
export function normalizeTrack(track: Track): void {
  track.keyframes.sort((a, b) => a.t - b.t);
  for (let i = track.keyframes.length - 1; i > 0; i--) {
    if (Math.abs(track.keyframes[i].t - track.keyframes[i - 1].t) < 1e-4) track.keyframes.splice(i - 1, 1);
  }
}

export function clipEnd(clip: AnimationClip): number {
  let end = clip.duration;
  for (const t of clip.tracks) for (const k of t.keyframes) end = Math.max(end, k.t);
  for (const sp of Object.values(clip.spans || {})) if (sp?.out != null) end = Math.max(end, sp.out);
  return end;
}

/* ------------------------------------------------------------------ */
/* Playback                                                             */
/* ------------------------------------------------------------------ */

export interface PlayingClip {
  clip: AnimationClip;
  time: number;
  speed: number;
  loop: boolean;
  done: boolean;
  resolve: (() => void)[];
  mediaStarted: Set<string>;
  paused?: boolean;
}

/**
 * Plays animation clips against a live property state. Used by the runtime;
 * the editor samples clips directly at the playhead instead.
 */
export class AnimationPlayer {
  playing = new Map<string, PlayingClip>();

  constructor(
    private engine: Engine,
    private clips: () => AnimationClip[],
    private propDef: (layerId: string, prop: string) => PropDef | undefined,
    private write: (layerId: string, prop: string, value: any) => void,
    private onFinished: (clipId: string) => void,
    private media: { play(layerId: string, offset: number): void; stop(layerId: string): void },
    private lookup?: LayerLookup,
  ) {}

  play(clipId: string, opts: { restart?: boolean; loop?: boolean; speed?: number } = {}): Promise<void> {
    const clip = this.clips().find((c) => c.id === clipId);
    if (!clip) return Promise.resolve();
    let p = this.playing.get(clipId);
    if (!p || opts.restart !== false || p.done) {
      p = { clip, time: 0, speed: opts.speed ?? 1, loop: opts.loop ?? clip.loop, done: false, resolve: [], mediaStarted: new Set() };
      this.playing.set(clipId, p);
      this.apply(p);
    }
    const playing = p;
    return new Promise((res) => playing.resolve.push(res));
  }

  stop(clipId: string): void {
    const p = this.playing.get(clipId);
    if (!p) return;
    for (const m of p.clip.media) if (p.mediaStarted.has(m.id)) this.media.stop(m.layerId);
    this.playing.delete(clipId);
    p.resolve.forEach((r) => r());
  }

  stopAll(): void {
    for (const id of [...this.playing.keys()]) this.stop(id);
  }

  /** Take a playing clip out without stopping it or its media (it continues on the next page). */
  detach(clipId: string): PlayingClip | undefined {
    const p = this.playing.get(clipId);
    if (!p) return undefined;
    this.playing.delete(clipId);
    p.resolve.forEach((r) => r());
    p.resolve = [];
    return p;
  }

  /** Continue a clip taken from another page. */
  adopt(p: PlayingClip): void {
    this.playing.set(p.clip.id, p);
  }

  /** Pause / resume a playing clip where it is. */
  setPaused(clipId: string, paused: boolean): void {
    const p = this.playing.get(clipId);
    if (p) p.paused = paused;
  }

  isPlaying(clipId: string): boolean {
    const p = this.playing.get(clipId);
    return !!p && !p.done;
  }

  update(dt: number): void {
    for (const [id, p] of [...this.playing]) {
      if (p.done || p.paused) continue;
      p.time += dt * p.speed;
      const end = clipEnd(p.clip);
      if (p.time >= end) {
        if (p.loop && end > 0) {
          p.time = p.time % end;
          p.mediaStarted.clear();
        } else {
          p.time = end;
          this.apply(p);
          p.done = true;
          this.playing.delete(id);
          p.resolve.forEach((r) => r());
          this.onFinished(id);
          continue;
        }
      }
      this.apply(p);
    }
  }

  private apply(p: PlayingClip): void {
    const values = sampleClip(this.engine, p.clip, p.time, this.propDef, new Map(), this.lookup);
    for (const [layerId, rec] of values) for (const [k, v] of Object.entries(rec)) this.write(layerId, k, v);
    for (const m of p.clip.media) {
      if (!p.mediaStarted.has(m.id) && p.time >= m.start) {
        p.mediaStarted.add(m.id);
        this.media.play(m.layerId, m.trimIn + (p.time - m.start));
      }
      if (p.mediaStarted.has(m.id) && m.duration != null && p.time >= m.start + m.duration) this.media.stop(m.layerId);
    }
  }
}
