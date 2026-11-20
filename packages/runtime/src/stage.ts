import { ensureRuntimeStyles } from './styles';

export interface StageOptions {
  /** "contain" letterboxes into the container; "manual" lets the editor pan and zoom. */
  fit?: 'contain' | 'manual';
  background?: string;
  maxPixelRatio?: number;
}

/**
 * The presentation surface: a canvas for scene layers plus a DOM overlay for the
 * dialogue box, choices and menus. Both live in a W×H "virtual resolution" frame
 * that is scaled as a unit, so the editor canvas and the exported game lay out
 * identically.
 */
export class Stage {
  readonly wrap: HTMLDivElement;
  readonly frame: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLDivElement;
  readonly ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  pixelRatio = 1;
  private ro: ResizeObserver | null = null;
  private opts: Required<StageOptions>;
  onResize: (() => void) | null = null;

  constructor(readonly container: HTMLElement, width: number, height: number, opts: StageOptions = {}) {
    ensureRuntimeStyles();
    this.opts = { fit: opts.fit || 'contain', background: opts.background || '#000', maxPixelRatio: opts.maxPixelRatio || 2 };
    this.width = width;
    this.height = height;
    this.wrap = document.createElement('div');
    this.wrap.className = 'vne-stage';
    this.wrap.style.background = this.opts.background;
    this.frame = document.createElement('div');
    this.frame.className = 'vne-frame';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vne-canvas';
    this.overlay = document.createElement('div');
    this.overlay.className = 'vne-overlay';
    this.frame.append(this.canvas, this.overlay);
    this.wrap.append(this.frame);
    container.append(this.wrap);
    this.ctx = this.canvas.getContext('2d')!;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(container);
    }
    this.layout();
  }

  setResolution(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.layout();
  }

  /** Editor: set explicit zoom and pan (stage pixels → container pixels). */
  setView(scale: number, offsetX: number, offsetY: number): void {
    this.scale = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.applyTransform();
  }

  fitScale(): { scale: number; offsetX: number; offsetY: number } {
    const cw = this.container.clientWidth || this.width;
    const ch = this.container.clientHeight || this.height;
    const scale = Math.min(cw / this.width, ch / this.height);
    return { scale, offsetX: (cw - this.width * scale) / 2, offsetY: (ch - this.height * scale) / 2 };
  }

  layout(): void {
    if (this.opts.fit === 'contain') {
      const f = this.fitScale();
      this.scale = f.scale;
      this.offsetX = f.offsetX;
      this.offsetY = f.offsetY;
    }
    this.applyTransform();
    this.onResize?.();
  }

  private applyTransform(): void {
    const dpr = (globalThis as any).devicePixelRatio || 1;
    const pr = Math.max(0.5, Math.min(this.opts.maxPixelRatio, this.scale * dpr));
    const cw = Math.round(this.width * pr);
    const chh = Math.round(this.height * pr);
    if (this.canvas.width !== cw || this.canvas.height !== chh) {
      this.canvas.width = cw;
      this.canvas.height = chh;
    }
    this.pixelRatio = pr;
    this.frame.style.width = `${this.width}px`;
    this.frame.style.height = `${this.height}px`;
    this.frame.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
  }

  /** Convert a pointer position (client coordinates) to stage coordinates. */
  toStage(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.container.getBoundingClientRect();
    return { x: (clientX - r.left - this.offsetX) / this.scale, y: (clientY - r.top - this.offsetY) / this.scale };
  }

  /** Begin a frame: returns the 2D context set up for stage coordinates. */
  begin(): CanvasRenderingContext2D {
    const c = this.ctx;
    c.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.filter = 'none';
    return c;
  }

  dispose(): void {
    this.ro?.disconnect();
    this.wrap.remove();
  }
}
