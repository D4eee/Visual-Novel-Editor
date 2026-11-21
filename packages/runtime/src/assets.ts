import type { Asset, Project } from '@vne/core';

export type AssetUrlResolver = (asset: Asset) => string;

/**
 * Loads project media lazily. Only assets that are actually drawn or played are
 * fetched, and images are cached by asset id so repeated use costs nothing.
 */
export class AssetLoader {
  private images = new Map<string, { img: HTMLImageElement; ready: boolean; failed: boolean; url: string }>();
  private fonts = new Set<string>();
  onLoad: (() => void) | null = null;
  missing = new Set<string>();

  constructor(private project: () => Project, readonly resolveUrl: AssetUrlResolver) {}

  asset(id: string | null | undefined): Asset | undefined {
    if (!id) return undefined;
    return this.project().assets.find((a) => a.id === id);
  }

  url(id: string | null | undefined): string | null {
    const a = this.asset(id);
    return a ? this.resolveUrl(a) : null;
  }

  /** Returns a decoded image or null while loading / when missing. */
  image(id: string | null | undefined): HTMLImageElement | null {
    if (!id) return null;
    const a = this.asset(id);
    if (!a) { this.missing.add(id); return null; }
    const url = this.resolveUrl(a);
    let e = this.images.get(id);
    if (e && e.url !== url) { this.images.delete(id); e = undefined; }
    if (!e) {
      const img = new Image();
      img.decoding = 'async';
      const entry = { img, ready: false, failed: false, url };
      img.onload = () => { entry.ready = true; this.onLoad?.(); };
      img.onerror = () => { entry.failed = true; this.missing.add(id); this.onLoad?.(); };
      img.src = url;
      this.images.set(id, entry);
      e = entry;
    }
    return e.ready ? e.img : null;
  }

  imageFailed(id: string | null | undefined): boolean {
    if (!id) return false;
    return !!this.images.get(id)?.failed || !this.asset(id);
  }

  async preloadImages(ids: Iterable<string>): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const id of ids) {
      this.image(id);
      const e = this.images.get(id);
      if (e && !e.ready && !e.failed) waits.push(new Promise((res) => { e.img.addEventListener('load', () => res(), { once: true }); e.img.addEventListener('error', () => res(), { once: true }); }));
    }
    await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 4000))]);
  }

  /** Register font assets with the document so text layers can use them by asset name. */
  loadFonts(): void {
    const g: any = globalThis as any;
    if (!g.FontFace || !g.document?.fonts) return;
    for (const a of this.project().assets) {
      if (a.kind !== 'font' || this.fonts.has(a.id)) continue;
      this.fonts.add(a.id);
      const family = fontFamilyName(a);
      const face = new g.FontFace(family, `url("${this.resolveUrl(a)}")`);
      face.load().then((f: any) => { g.document.fonts.add(f); this.onLoad?.(); }).catch(() => this.missing.add(a.id));
    }
  }

  invalidate(id?: string): void {
    if (id) this.images.delete(id);
    else this.images.clear();
  }
}

export function fontFamilyName(a: Asset): string {
  return `vne-${a.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/* ------------------------------------------------------------------ */
/* Audio                                                                */
/* ------------------------------------------------------------------ */

export type AudioCategory = 'bgm' | 'sfx' | 'voice' | 'ambient';

export interface Volumes { master: number; bgm: number; sfx: number; voice: number; ambient: number }

/**
 * Mixes audio through HTMLMediaElements with per-category volume. Background
 * music is a single persistent channel so it continues seamlessly across scenes.
 */
export class AudioManager {
  volumes: Volumes = { master: 1, bgm: 0.8, sfx: 1, voice: 1, ambient: 0.8 };
  muted = false;
  private bgm: { el: HTMLAudioElement; assetId: string; base: number; fade?: number } | null = null;
  private owned = new Set<HTMLMediaElement>();
  private registry = new Set<{ el: HTMLMediaElement; category: AudioCategory; base: number }>();

  constructor(private assets: AssetLoader) {}

  effective(category: AudioCategory, base: number): number {
    if (this.muted) return 0;
    return Math.max(0, Math.min(1, base * this.volumes.master * (this.volumes[category] ?? 1)));
  }

  /** Track a media element (audio/video layer) so volume settings apply to it. */
  track(el: HTMLMediaElement, category: AudioCategory, base: number): { setBase(v: number): void; untrack(): void } {
    const rec = { el, category, base };
    this.registry.add(rec);
    el.volume = this.effective(category, base);
    return {
      setBase: (v: number) => { rec.base = v; el.volume = this.effective(category, v); },
      untrack: () => this.registry.delete(rec),
    };
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    for (const r of this.registry) r.el.volume = this.effective(r.category, r.base);
    if (this.bgm) this.bgm.el.volume = this.effective('bgm', this.bgm.base);
  }

  playMusic(assetId: string, volume = 1, loop = true, fade = 0.8): void {
    if (this.bgm && this.bgm.assetId === assetId) {
      this.bgm.base = volume;
      this.bgm.el.volume = this.effective('bgm', volume);
      if (this.bgm.el.paused) this.bgm.el.play().catch(() => {});
      return;
    }
    this.stopMusic(fade);
    const url = this.assets.url(assetId);
    if (!url) return;
    const el = new Audio(url);
    el.loop = loop;
    el.volume = 0;
    this.bgm = { el, assetId, base: volume };
    el.play().catch(() => {});
    this.fadeTo(el, this.effective('bgm', volume), fade);
  }

  stopMusic(fade = 0.6): void {
    if (!this.bgm) return;
    const el = this.bgm.el;
    this.bgm = null;
    this.fadeTo(el, 0, fade, () => { el.pause(); el.src = ''; });
  }

  pauseMusic(): void { this.bgm?.el.pause(); }
  resumeMusic(): void { if (this.bgm?.el.paused) this.bgm.el.play().catch(() => {}); }
  get musicPlaying(): boolean { return !!this.bgm && !this.bgm.el.paused; }

  get musicAssetId(): string | null {
    return this.bgm?.assetId ?? null;
  }

  playSound(assetId: string, volume = 1, category: AudioCategory = 'sfx'): HTMLAudioElement | null {
    const url = this.assets.url(assetId);
    if (!url) return null;
    const el = new Audio(url);
    el.volume = this.effective(category, volume);
    this.owned.add(el);
    el.addEventListener('ended', () => this.owned.delete(el));
    el.play().catch(() => {});
    return el;
  }

  stopSounds(): void {
    for (const el of this.owned) { el.pause(); el.src = ''; }
    this.owned.clear();
  }

  private fadeTo(el: HTMLMediaElement, target: number, seconds: number, done?: () => void): void {
    if (seconds <= 0) { el.volume = target; done?.(); return; }
    const start = el.volume;
    const t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      el.volume = Math.max(0, Math.min(1, start + (target - start) * u));
      if (u < 1) requestAnimationFrame(step); else done?.();
    };
    requestAnimationFrame(step);
  }

  dispose(): void {
    this.stopMusic(0);
    this.stopSounds();
    for (const r of this.registry) r.el.pause();
    this.registry.clear();
  }
}
