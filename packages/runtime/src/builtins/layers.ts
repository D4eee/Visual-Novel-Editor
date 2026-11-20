import type { Engine, Layer, LayerTypeDef, PropDef, Composition } from '@vne/core';
import { num, parseColor, colorToString } from '../math';
import { parseRich, layoutRich, drawRich, interpolateVars, TextStyle } from '../text';
import type { RenderContext, SceneView } from '../render';
import { drawLayerList, measureCtx } from '../render';
import type { AudioCategory } from '../assets';
import { fontFamilyName } from '../assets';

export const TRANSFORM_PROPS: PropDef[] = [
  { key: 'x', type: 'number', label: 'prop.x', default: 0, step: 1, unit: 'px', animatable: true, group: 'transform' },
  { key: 'y', type: 'number', label: 'prop.y', default: 0, step: 1, unit: 'px', animatable: true, group: 'transform' },
  { key: 'scaleX', type: 'number', label: 'prop.scaleX', default: 1, step: 0.01, animatable: true, group: 'transform' },
  { key: 'scaleY', type: 'number', label: 'prop.scaleY', default: 1, step: 0.01, animatable: true, group: 'transform' },
  { key: 'rotation', type: 'number', label: 'prop.rotation', default: 0, step: 1, unit: '°', animatable: true, group: 'transform' },
  { key: 'anchorX', type: 'number', label: 'prop.anchorX', default: 0.5, step: 0.05, min: 0, max: 1, animatable: true, group: 'transform' },
  { key: 'anchorY', type: 'number', label: 'prop.anchorY', default: 0.5, step: 0.05, min: 0, max: 1, animatable: true, group: 'transform' },
  { key: 'opacity', type: 'number', label: 'prop.opacity', default: 1, step: 0.05, min: 0, max: 1, animatable: true, group: 'transform' },
];

const visual = (props: PropDef[]): PropDef[] => [...TRANSFORM_PROPS, ...props];

function imgOf(rc: { assets: any }, id: any): HTMLImageElement | null {
  return rc.assets.image(id);
}

function naturalSize(view: SceneView | any, assetId: string | null | undefined): { width: number; height: number } | null {
  const a = view.assets?.asset(assetId);
  if (a?.meta?.width && a?.meta?.height) return { width: Number(a.meta.width), height: Number(a.meta.height) };
  const img = assetId ? view.assets?.image(assetId) : null;
  if (img && img.naturalWidth) return { width: img.naturalWidth, height: img.naturalHeight };
  return null;
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number, label: string, missing: boolean): void {
  ctx.save();
  ctx.fillStyle = missing ? 'rgba(220,70,100,0.16)' : 'rgba(140,150,190,0.14)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = missing ? 'rgba(255,100,130,0.8)' : 'rgba(170,180,220,0.5)';
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.setLineDash([]);
  ctx.fillStyle = missing ? '#ffb3c1' : 'rgba(220,225,245,0.8)';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2, Math.max(10, w - 12));
  ctx.restore();
}

function drawFitted(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, iw: number, ih: number, w: number, h: number, fit: string): void {
  if (fit === 'stretch' || !iw || !ih) { ctx.drawImage(img, 0, 0, w, h); return; }
  const s = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function resolveFont(rc: { assets: any; project: any }, family: string): string {
  if (!family) return 'system-ui, sans-serif';
  const asset = rc.project.assets.find((a: any) => a.kind === 'font' && a.id === family);
  return asset ? `"${fontFamilyName(asset)}", system-ui, sans-serif` : family;
}

function textStyle(rc: any, p: Record<string, any>): TextStyle {
  return {
    fontFamily: resolveFont(rc, p.fontFamily),
    fontSize: num(p.fontSize, 32),
    fontWeight: p.fontWeight || 'normal',
    italic: !!p.italic,
    color: p.color || '#ffffff',
    lineHeight: num(p.lineHeight, 1.3),
    letterSpacing: num(p.letterSpacing, 0),
    align: p.align || 'left',
  };
}

function varLookup(view: any): (name: string) => string | undefined {
  return (name: string) => {
    const v = view?.project?.variables?.find((x: any) => x.name === name);
    if (!v) return undefined;
    const val = view.vars.get(v.id);
    return val === undefined ? undefined : String(val);
  };
}

function textLayout(rc: any, p: Record<string, any>) {
  const ctx: CanvasRenderingContext2D = measureCtx();
  const style = textStyle(rc, p);
  const raw = interpolateVars(String(p.text ?? ''), varLookup(rc.view || rc));
  const tokens = parseRich(raw);
  const total = [...tokens].reduce((n, t) => n + (t.kind === 'run' ? [...t.run.text].length : 0), 0);
  const reveal = p.reveal === undefined ? 1 : Math.max(0, Math.min(1, num(p.reveal, 1)));
  const maxChars = reveal >= 1 ? Infinity : Math.floor(total * reveal);
  const width = num(p.width, 0);
  const full = layoutRich(ctx, tokens, style, width);
  const shown = maxChars === Infinity ? full : layoutRich(ctx, tokens, style, width, maxChars);
  return { style, full, shown, boxWidth: width > 0 ? width : full.width };
}

/* ------------------------------------------------------------------ */

export function registerBuiltinLayers(engine: Engine): void {
  const reg = (def: LayerTypeDef) => engine.layerTypes.register(def, 'core');

  reg({
    id: 'core.background', label: 'layer.background', icon: 'image', category: 'media', visual: true,
    props: visual([
      { key: 'assetId', type: 'asset', assetKind: 'image', label: 'prop.image', default: null },
      { key: 'color', type: 'color', label: 'prop.color', default: '#20222e', animatable: true },
      { key: 'fit', type: 'select', label: 'prop.fit', default: 'cover', options: [{ value: 'cover', label: 'fit.cover' }, { value: 'contain', label: 'fit.contain' }, { value: 'stretch', label: 'fit.stretch' }] },
    ]),
    size: (_l, _p, rc) => ({ ...rc.project.settings.resolution }),
    draw(rc: RenderContext, _l, p) {
      const { width, height } = rc.project.settings.resolution;
      rc.ctx.fillStyle = p.color || '#000';
      rc.ctx.fillRect(0, 0, width, height);
      const img = imgOf(rc, p.assetId);
      if (img) drawFitted(rc.ctx, img, img.naturalWidth, img.naturalHeight, width, height, p.fit || 'cover');
      else if (p.assetId && rc.assets.imageFailed(p.assetId)) drawPlaceholder(rc.ctx, width, height, 'Missing image', true);
    },
  });

  reg({
    id: 'core.image', label: 'layer.image', icon: 'image', category: 'media', visual: true,
    props: visual([
      { key: 'assetId', type: 'asset', assetKind: 'image', label: 'prop.image', default: null },
      { key: 'width', type: 'number', label: 'prop.width', default: 0, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'height', type: 'number', label: 'prop.height', default: 0, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'cropLeft', type: 'number', label: 'prop.cropLeft', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'crop' },
      { key: 'cropTop', type: 'number', label: 'prop.cropTop', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'crop' },
      { key: 'cropRight', type: 'number', label: 'prop.cropRight', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'crop' },
      { key: 'cropBottom', type: 'number', label: 'prop.cropBottom', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'crop' },
    ]),
    size(_l, p, rc) {
      const n = naturalSize(rc, p.assetId);
      const w = num(p.width), h = num(p.height);
      if (w && h) return { width: w, height: h };
      if (n) {
        if (w) return { width: w, height: (w * n.height) / n.width };
        if (h) return { width: (h * n.width) / n.height, height: h };
        return n;
      }
      return { width: w || 320, height: h || 240 };
    },
    draw(rc, l, p) {
      const s = engine.layerTypes.get('core.image')!.size!(l, p, rc);
      const img = imgOf(rc, p.assetId);
      if (!img) { drawPlaceholder(rc.ctx, s.width, s.height, p.assetId ? (rc.assets.imageFailed(p.assetId) ? 'Missing image' : '…') : 'Image', !!p.assetId && rc.assets.imageFailed(p.assetId)); return; }
      const cl = num(p.cropLeft), ct = num(p.cropTop), cr = num(p.cropRight), cb = num(p.cropBottom);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const sx = iw * cl, sy = ih * ct, sw = Math.max(1, iw * (1 - cl - cr)), sh = Math.max(1, ih * (1 - ct - cb));
      rc.ctx.drawImage(img, sx, sy, sw, sh, s.width * cl, s.height * ct, s.width * (1 - cl - cr), s.height * (1 - ct - cb));
    },
  });

  reg({
    id: 'core.character', label: 'layer.character', icon: 'user', category: 'media', visual: true,
    props: visual([
      { key: 'characterId', type: 'character', label: 'prop.character', default: null },
      { key: 'portraitId', type: 'portrait', label: 'prop.portrait', default: null },
      { key: 'height', type: 'number', label: 'prop.displayHeight', default: 0, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'flip', type: 'boolean', label: 'prop.flip', default: false },
      { key: 'dim', type: 'number', label: 'prop.dim', default: 0, min: 0, max: 1, step: 0.05, animatable: true },
    ]),
    defaults: ({ height }) => ({ y: height, anchorY: 1 }),
    size(_l, p, rc) {
      const assetId = portraitAsset(rc.project, p.characterId, p.portraitId);
      const n = naturalSize(rc, assetId);
      const h = num(p.height);
      if (n) return h ? { width: (h * n.width) / n.height, height: h } : n;
      return { width: h ? h * 0.5 : 300, height: h || 600 };
    },
    draw(rc, l, p) {
      const s = engine.layerTypes.get('core.character')!.size!(l, p, rc);
      const assetId = portraitAsset(rc.project, p.characterId, p.portraitId);
      const img = imgOf(rc, assetId);
      if (!img) {
        const ch = rc.project.characters.find((c) => c.id === p.characterId);
        drawPlaceholder(rc.ctx, s.width, s.height, ch ? ch.name : 'Character', !!assetId && rc.assets.imageFailed(assetId));
        return;
      }
      rc.ctx.save();
      if (p.flip) { rc.ctx.translate(s.width, 0); rc.ctx.scale(-1, 1); }
      rc.ctx.drawImage(img, 0, 0, s.width, s.height);
      const dim = num(p.dim);
      if (dim > 0) {
        rc.ctx.globalCompositeOperation = 'source-atop';
        rc.ctx.fillStyle = `rgba(0,0,0,${dim * 0.6})`;
        rc.ctx.fillRect(0, 0, s.width, s.height);
      }
      rc.ctx.restore();
    },
  });

  reg({
    id: 'core.text', label: 'layer.text', icon: 'type', category: 'text', visual: true,
    props: visual([
      { key: 'text', type: 'text', label: 'prop.text', default: 'Text' },
      { key: 'fontFamily', type: 'font', label: 'prop.font', default: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif', group: 'text' },
      { key: 'fontSize', type: 'number', label: 'prop.fontSize', default: 40, min: 4, unit: 'px', animatable: true, group: 'text' },
      { key: 'fontWeight', type: 'select', label: 'prop.fontWeight', default: 'normal', options: [{ value: 'normal', label: 'weight.normal' }, { value: '600', label: 'weight.semibold' }, { value: 'bold', label: 'weight.bold' }], group: 'text' },
      { key: 'italic', type: 'boolean', label: 'prop.italic', default: false, group: 'text' },
      { key: 'color', type: 'color', label: 'prop.color', default: '#ffffff', animatable: true, group: 'text' },
      { key: 'align', type: 'select', label: 'prop.align', default: 'left', options: [{ value: 'left', label: 'align.left' }, { value: 'center', label: 'align.center' }, { value: 'right', label: 'align.right' }], group: 'text' },
      { key: 'width', type: 'number', label: 'prop.wrapWidth', default: 0, min: 0, unit: 'px', animatable: true, group: 'text' },
      { key: 'lineHeight', type: 'number', label: 'prop.lineHeight', default: 1.3, step: 0.05, group: 'text' },
      { key: 'letterSpacing', type: 'number', label: 'prop.letterSpacing', default: 0, step: 0.5, animatable: true, group: 'text' },
      { key: 'reveal', type: 'number', label: 'prop.reveal', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'text', description: 'prop.reveal.desc' },
      { key: 'strokeColor', type: 'color', label: 'prop.strokeColor', default: '#000000', animatable: true, group: 'style' },
      { key: 'strokeWidth', type: 'number', label: 'prop.strokeWidth', default: 0, min: 0, animatable: true, group: 'style' },
      { key: 'shadowColor', type: 'color', label: 'prop.shadowColor', default: 'rgba(0,0,0,0.6)', animatable: true, group: 'style' },
      { key: 'shadowBlur', type: 'number', label: 'prop.shadowBlur', default: 0, min: 0, animatable: true, group: 'style' },
    ]),
    size(_l, p, rc) {
      const { full, boxWidth } = textLayout(rc, p);
      return { width: Math.max(4, boxWidth), height: Math.max(num(p.fontSize, 32), full.height) };
    },
    draw(rc, _l, p) {
      const { style, shown, boxWidth } = textLayout(rc, p);
      const ctx = rc.ctx;
      ctx.save();
      if (num(p.shadowBlur) > 0) { ctx.shadowColor = p.shadowColor; ctx.shadowBlur = num(p.shadowBlur); ctx.shadowOffsetY = num(p.shadowBlur) / 4; }
      drawRich(ctx, shown, style, boxWidth, rc.time, { stroke: p.strokeColor, strokeWidth: num(p.strokeWidth) });
      ctx.restore();
    },
  });

  reg({
    id: 'core.shape', label: 'layer.shape', icon: 'square', category: 'ui', visual: true,
    props: visual([
      { key: 'shape', type: 'select', label: 'prop.shape', default: 'rect', options: [{ value: 'rect', label: 'shape.rect' }, { value: 'ellipse', label: 'shape.ellipse' }, { value: 'triangle', label: 'shape.triangle' }, { value: 'line', label: 'shape.line' }] },
      { key: 'width', type: 'number', label: 'prop.width', default: 400, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'height', type: 'number', label: 'prop.height', default: 240, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'fill', type: 'color', label: 'prop.fill', default: 'rgba(90,110,200,0.85)', animatable: true, group: 'style' },
      { key: 'gradient', type: 'select', label: 'prop.gradient', default: 'none', options: [{ value: 'none', label: 'gradient.none' }, { value: 'linear', label: 'gradient.linear' }, { value: 'radial', label: 'gradient.radial' }], group: 'style' },
      { key: 'fill2', type: 'color', label: 'prop.fill2', default: 'rgba(20,20,40,0.9)', animatable: true, group: 'style' },
      { key: 'gradientAngle', type: 'number', label: 'prop.gradientAngle', default: 90, unit: '°', animatable: true, group: 'style' },
      { key: 'stroke', type: 'color', label: 'prop.stroke', default: 'rgba(255,255,255,0.0)', animatable: true, group: 'style' },
      { key: 'strokeWidth', type: 'number', label: 'prop.strokeWidth', default: 0, min: 0, animatable: true, group: 'style' },
      { key: 'radius', type: 'number', label: 'prop.radius', default: 12, min: 0, animatable: true, group: 'style' },
    ]),
    size: (_l, p) => ({ width: num(p.width, 100), height: num(p.height, 100) }),
    draw(rc, _l, p) {
      const ctx = rc.ctx;
      const w = num(p.width, 100), h = num(p.height, 100);
      let fill: string | CanvasGradient = p.fill;
      if (p.gradient === 'linear') {
        const a = (num(p.gradientAngle, 90) * Math.PI) / 180;
        const dx = Math.cos(a) * w / 2, dy = Math.sin(a) * h / 2;
        const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
        g.addColorStop(0, p.fill); g.addColorStop(1, p.fill2);
        fill = g;
      } else if (p.gradient === 'radial') {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
        g.addColorStop(0, p.fill); g.addColorStop(1, p.fill2);
        fill = g;
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = num(p.strokeWidth);
      ctx.beginPath();
      if (p.shape === 'ellipse') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (p.shape === 'triangle') { ctx.moveTo(w / 2, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); }
      else if (p.shape === 'line') { ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.lineWidth = Math.max(1, num(p.strokeWidth) || h); ctx.strokeStyle = typeof fill === 'string' ? fill : p.fill; ctx.stroke(); return; }
      else roundRect(ctx, 0, 0, w, h, num(p.radius));
      ctx.fill();
      if (num(p.strokeWidth) > 0) ctx.stroke();
    },
  });

  reg({
    id: 'core.button', label: 'layer.button', icon: 'button', category: 'ui', visual: true,
    props: visual([
      { key: 'text', type: 'string', label: 'prop.text', default: 'Button' },
      { key: 'width', type: 'number', label: 'prop.width', default: 260, min: 10, unit: 'px', animatable: true, group: 'size' },
      { key: 'height', type: 'number', label: 'prop.height', default: 64, min: 10, unit: 'px', animatable: true, group: 'size' },
      { key: 'fontSize', type: 'number', label: 'prop.fontSize', default: 26, min: 6, animatable: true, group: 'style' },
      { key: 'textColor', type: 'color', label: 'prop.textColor', default: '#ffffff', animatable: true, group: 'style' },
      { key: 'fill', type: 'color', label: 'prop.fill', default: 'rgba(40,46,80,0.9)', animatable: true, group: 'style' },
      { key: 'hoverFill', type: 'color', label: 'prop.hoverFill', default: 'rgba(80,100,190,0.95)', group: 'style' },
      { key: 'radius', type: 'number', label: 'prop.radius', default: 14, min: 0, group: 'style' },
      { key: 'enabled', type: 'boolean', label: 'prop.enabled', default: true },
    ]),
    size: (_l, p) => ({ width: num(p.width, 200), height: num(p.height, 60) }),
    createInstance: () => ({ hover: false, pressed: false }),
    draw(rc, l, p) {
      const ctx = rc.ctx;
      const w = num(p.width, 200), h = num(p.height, 60);
      const inst = rc.view.instance(l.id);
      ctx.fillStyle = inst?.hover && p.enabled !== false ? p.hoverFill : p.fill;
      if (p.enabled === false) ctx.globalAlpha *= 0.5;
      roundRect(ctx, 0, 0, w, h, num(p.radius));
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = p.textColor;
      ctx.font = `600 ${num(p.fontSize, 24)}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.text ?? ''), w / 2, h / 2 + 1, w - 16);
    },
  });

  reg({
    id: 'core.hotspot', label: 'layer.hotspot', icon: 'target', category: 'interactive', visual: true,
    props: visual([
      { key: 'width', type: 'number', label: 'prop.width', default: 200, min: 1, unit: 'px', animatable: true, group: 'size' },
      { key: 'height', type: 'number', label: 'prop.height', default: 200, min: 1, unit: 'px', animatable: true, group: 'size' },
      { key: 'cursor', type: 'select', label: 'prop.cursor', default: 'pointer', options: [{ value: 'pointer', label: 'cursor.pointer' }, { value: 'default', label: 'cursor.default' }, { value: 'zoom-in', label: 'cursor.zoom' }] },
      { key: 'highlight', type: 'boolean', label: 'prop.highlightHover', default: false },
    ]),
    size: (_l, p) => ({ width: num(p.width, 100), height: num(p.height, 100) }),
    createInstance: () => ({ hover: false }),
    draw(rc, l, p) {
      const w = num(p.width, 100), h = num(p.height, 100);
      const inst = rc.view.instance(l.id);
      if (rc.mode === 'edit') {
        rc.ctx.fillStyle = 'rgba(80, 200, 255, 0.12)';
        rc.ctx.fillRect(0, 0, w, h);
        rc.ctx.strokeStyle = 'rgba(80, 200, 255, 0.9)';
        rc.ctx.setLineDash([10, 6]);
        rc.ctx.lineWidth = 2;
        rc.ctx.strokeRect(1, 1, w - 2, h - 2);
        rc.ctx.setLineDash([]);
      } else if (p.highlight && inst?.hover) {
        rc.ctx.fillStyle = 'rgba(255,255,255,0.12)';
        rc.ctx.fillRect(0, 0, w, h);
      }
    },
  });

  reg({
    id: 'core.video', label: 'layer.video', icon: 'film', category: 'media', visual: true,
    props: visual([
      { key: 'assetId', type: 'asset', assetKind: 'video', label: 'prop.video', default: null },
      { key: 'width', type: 'number', label: 'prop.width', default: 0, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'height', type: 'number', label: 'prop.height', default: 0, min: 0, unit: 'px', animatable: true, group: 'size' },
      { key: 'autoplay', type: 'boolean', label: 'prop.autoplay', default: true, group: 'playback' },
      { key: 'loop', type: 'boolean', label: 'prop.loop', default: false, group: 'playback' },
      { key: 'muted', type: 'boolean', label: 'prop.muted', default: false, group: 'playback' },
      { key: 'volume', type: 'number', label: 'prop.volume', default: 1, min: 0, max: 1, step: 0.05, animatable: true, group: 'playback' },
    ]),
    size(_l, p, rc) {
      const a = rc.assets?.asset(p.assetId);
      const nw = Number(a?.meta?.width) || 1280, nh = Number(a?.meta?.height) || 720;
      const w = num(p.width), h = num(p.height);
      if (w && h) return { width: w, height: h };
      if (w) return { width: w, height: (w * nh) / nw };
      if (h) return { width: (h * nw) / nh, height: h };
      return { width: nw, height: nh };
    },
    createInstance: (layer, rt) => createMediaInstance(layer, rt, 'video'),
  });

  reg({
    id: 'core.audio', label: 'layer.audio', icon: 'music', category: 'media', visual: false,
    props: [
      { key: 'assetId', type: 'asset', assetKind: 'audio', label: 'prop.audio', default: null },
      { key: 'category', type: 'select', label: 'prop.audioCategory', default: 'bgm', options: [{ value: 'bgm', label: 'audio.bgm' }, { value: 'sfx', label: 'audio.sfx' }, { value: 'voice', label: 'audio.voice' }, { value: 'ambient', label: 'audio.ambient' }] },
      { key: 'autoplay', type: 'boolean', label: 'prop.autoplay', default: true },
      { key: 'loop', type: 'boolean', label: 'prop.loop', default: true },
      { key: 'volume', type: 'number', label: 'prop.volume', default: 1, min: 0, max: 1, step: 0.05, animatable: true },
      { key: 'persist', type: 'boolean', label: 'prop.persist', default: true, description: 'prop.persist.desc' },
    ],
    createInstance: (layer, rt) => createMediaInstance(layer, rt, 'audio'),
  });

  reg({
    id: 'core.group', label: 'layer.group', icon: 'folder', category: 'structure', visual: true,
    props: TRANSFORM_PROPS.map((p) => (p.key === 'anchorX' || p.key === 'anchorY' ? { ...p, hidden: true } : p)),
    defaults: () => ({ x: 0, y: 0 }),
    size: () => ({ width: 0, height: 0 }),
    draw(rc, l) { rc.drawChildren(l.id); },
  });

  reg({
    id: 'core.composition', label: 'layer.composition', icon: 'layers', category: 'structure', visual: true,
    props: visual([{ key: 'compositionId', type: 'json', label: 'prop.composition', default: null }]),
    size(_l, p, rc) {
      const c: Composition | undefined = rc.project.compositions.find((x: Composition) => x.id === p.compositionId);
      return c ? { width: c.width, height: c.height } : { width: 200, height: 200 };
    },
    draw(rc, _l, p) {
      const c: Composition | undefined = rc.project.compositions.find((x: Composition) => x.id === p.compositionId);
      if (!c) { drawPlaceholder(rc.ctx, 200, 200, 'Missing composition', true); return; }
      const nested: SceneView = { ...rc.view, layers: c.layers, props: (l) => l.props, visible: (l) => l.visible, instance: () => undefined };
      drawLayerList(rc.ctx, nested, null, c.layers);
    },
  });

  reg({
    id: 'core.particles', label: 'layer.particles', icon: 'sparkles', category: 'effect', visual: true,
    props: visual([
      { key: 'kind', type: 'select', label: 'prop.particleKind', default: 'snow', options: [{ value: 'snow', label: 'particle.snow' }, { value: 'rain', label: 'particle.rain' }, { value: 'sparkle', label: 'particle.sparkle' }, { value: 'petals', label: 'particle.petals' }, { value: 'dust', label: 'particle.dust' }] },
      { key: 'width', type: 'number', label: 'prop.width', default: 1280, min: 1, unit: 'px', group: 'size' },
      { key: 'height', type: 'number', label: 'prop.height', default: 720, min: 1, unit: 'px', group: 'size' },
      { key: 'count', type: 'number', label: 'prop.count', default: 120, min: 0, max: 2000, step: 1, animatable: true },
      { key: 'speed', type: 'number', label: 'prop.speed', default: 1, min: 0, step: 0.1, animatable: true },
      { key: 'size', type: 'number', label: 'prop.particleSize', default: 4, min: 0.5, step: 0.5, animatable: true },
      { key: 'wind', type: 'number', label: 'prop.wind', default: 0.2, step: 0.1, animatable: true },
      { key: 'color', type: 'color', label: 'prop.color', default: '#ffffff', animatable: true },
    ]),
    defaults: ({ width, height }) => ({ width, height }),
    size: (_l, p) => ({ width: num(p.width, 1280), height: num(p.height, 720) }),
    createInstance: (layer) => createParticles(layer),
    draw(rc, l, p) {
      // Editor preview without an instance: draw a deterministic sample
      const inst = createParticles(l);
      inst.update!(0, p, rc.time);
      inst.draw!(rc, p);
    },
  });
}

export function portraitAsset(project: any, characterId: string | null, portraitId: string | null): string | null {
  const ch = project.characters.find((c: any) => c.id === characterId);
  if (!ch) return null;
  const p = ch.portraits.find((x: any) => x.id === portraitId) || ch.portraits[0];
  return p?.assetId || null;
}

/* ------------------------------------------------------------------ */
/* Media instances                                                       */
/* ------------------------------------------------------------------ */

export interface LayerRuntime {
  assets: any;
  audio: any;
  mode: 'edit' | 'play';
  emit(event: { type: string; [k: string]: any }): void;
  requestRender(): void;
}

function createMediaInstance(layer: Layer, rt: LayerRuntime, kind: 'video' | 'audio') {
  const p = layer.props;
  const url = rt.assets.url(p.assetId);
  const category: AudioCategory = kind === 'video' ? 'sfx' : (p.category || 'bgm');
  const useMusicChannel = kind === 'audio' && category === 'bgm' && p.persist !== false && rt.mode === 'play';
  let el: HTMLMediaElement | null = null;
  let track: { setBase(v: number): void; untrack(): void } | null = null;
  let started = false;
  let editLast = -1;
  if (url && !useMusicChannel) {
    el = kind === 'video' ? document.createElement('video') : new Audio();
    el.preload = 'auto';
    el.src = url;
    el.loop = !!p.loop;
    if (kind === 'video') { (el as HTMLVideoElement).playsInline = true; el.muted = !!p.muted || rt.mode === 'edit'; el.crossOrigin = 'anonymous'; }
    el.addEventListener('ended', () => rt.emit({ type: 'media.ended', layerId: layer.id }));
    el.addEventListener('loadeddata', () => rt.requestRender());
    // Browsers may not decode a frame until playback or a seek; in the editor, seek so the first frame shows.
    if (kind === 'video' && rt.mode === 'edit') el.addEventListener('loadedmetadata', () => { try { if (el && el.readyState < 2) el.currentTime = 0.001; } catch { /* ignore */ } });
    el.addEventListener('seeked', () => rt.requestRender());
    track = rt.audio.track(el, category, num(p.volume, 1));
  }
  const inst = {
    element: el,
    play(offset = 0) {
      started = true;
      if (useMusicChannel) { rt.audio.playMusic(p.assetId, num(p.volume, 1), p.loop !== false); return; }
      if (!el) return;
      try { if (offset) el.currentTime = offset; } catch { /* not seekable yet */ }
      el.play().catch(() => {});
    },
    pause() { if (useMusicChannel) return; el?.pause(); },
    stop() {
      if (useMusicChannel) { rt.audio.stopMusic(); return; }
      if (!el) return;
      el.pause();
      try { el.currentTime = 0; } catch { /* ignore */ }
    },
    seek(s: number) { if (el) try { el.currentTime = s; } catch { /* ignore */ } },
    update(_dt: number, props: Record<string, any>, time: number) {
      if (track) track.setBase(num(props.volume, 1));
      if (rt.mode === 'edit' && el && kind === 'video' && el.readyState >= 1) {
        // Editor: follow the playhead. While time runs forward smoothly let the element play
        // (correcting large drift only); when the playhead jumps or stops, pause and seek.
        const d = el.duration || 0;
        const target = Math.max(0, time);
        const t = d ? (props.loop ? target % d : Math.min(target, d - 0.05)) : 0;
        const delta = time - editLast;
        editLast = time;
        const running = delta > 0 && delta < 0.25 && (!d || props.loop || target < d);
        if (running) {
          if (el.paused) el.play().catch(() => {});
          if (!el.seeking && Math.abs(el.currentTime - t) > 0.6) try { el.currentTime = t; } catch { /* ignore */ }
        } else {
          if (!el.paused) el.pause();
          // readyState < 2: no frame decoded yet — a seek makes the browser decode one.
          if (!el.seeking && (Math.abs(el.currentTime - t) > 0.04 || el.readyState < 2)) try { el.currentTime = Math.max(0.001, t); } catch { /* ignore */ }
        }
      }
    },
    draw(rc: RenderContext, props: Record<string, any>) {
      if (kind !== 'video') return;
      const def = rc.engine.layerTypes.get('core.video')!;
      const s = def.size!(layer, props, rc);
      const v = el as HTMLVideoElement | null;
      if (v && v.readyState >= 2) rc.ctx.drawImage(v, 0, 0, s.width, s.height);
      else drawPlaceholder(rc.ctx, s.width, s.height, p.assetId ? (url ? '▶ Video' : 'Missing video') : 'Video', !url && !!p.assetId);
    },
    dispose() {
      track?.untrack();
      if (useMusicChannel) { if (p.persist === false || !started) return; return; }
      if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
    },
    get persistsMusic() { return useMusicChannel; },
  };
  return inst;
}

/* ------------------------------------------------------------------ */
/* Particles                                                             */
/* ------------------------------------------------------------------ */

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createParticles(layer: Layer) {
  let seed = 0;
  for (const ch of layer.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rand = mulberry(seed);
  const parts: { x: number; y: number; z: number; ph: number }[] = [];
  let time = 0;
  return {
    update(_dt: number, p: Record<string, any>, t: number) {
      time = t;
      const n = Math.max(0, Math.min(2000, Math.floor(num(p.count, 100))));
      while (parts.length < n) parts.push({ x: rand(), y: rand(), z: 0.4 + rand() * 0.6, ph: rand() * Math.PI * 2 });
      if (parts.length > n) parts.length = n;
    },
    draw(rc: RenderContext, p: Record<string, any>) {
      const ctx = rc.ctx;
      const w = num(p.width, 1280), h = num(p.height, 720);
      const speed = num(p.speed, 1), size = num(p.size, 4), wind = num(p.wind, 0);
      const c = parseColor(p.color);
      const kind = p.kind || 'snow';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      for (const q of parts) {
        const fall = kind === 'rain' ? 1.4 : kind === 'sparkle' || kind === 'dust' ? 0.05 : 0.12;
        const yy = ((q.y + time * speed * fall * q.z) % 1 + 1) % 1;
        const sway = kind === 'rain' ? 0 : Math.sin(time * 1.3 + q.ph) * 0.01;
        const xx = (((q.x + time * wind * 0.05 * q.z + sway) % 1) + 1) % 1;
        const x = xx * w, y = yy * h;
        const s = size * q.z;
        let alpha = c.a * q.z;
        if (kind === 'sparkle') alpha *= 0.5 + 0.5 * Math.sin(time * 4 + q.ph * 3);
        ctx.fillStyle = colorToString({ ...c, a: Math.max(0, alpha) });
        ctx.strokeStyle = ctx.fillStyle;
        if (kind === 'rain') { ctx.lineWidth = Math.max(1, s / 3); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + wind * 4, y + s * 5); ctx.stroke(); }
        else if (kind === 'petals') { ctx.save(); ctx.translate(x, y); ctx.rotate(time * q.z + q.ph); ctx.beginPath(); ctx.ellipse(0, 0, s * 1.4, s * 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.restore();
    },
  };
}
