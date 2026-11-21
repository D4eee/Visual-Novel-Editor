/**
 * Free dialogue: a dialogue box you place and style yourself — speaker name and text with
 * every text setting, a box of any shape (rounded, pill, ellipse, speech bubble with a
 * tail, thought bubble or none) with its own fill, outline and shadow, and a typewriter.
 * Every number and color can be keyframed on the timeline and changed from scripts.
 */
import type { Engine, LayerTypeDef, PropDef } from '@vne/core';
import { num } from '../math';
import { parseRich, layoutRich, drawRich, interpolateVars, countChars } from '../text';
import type { TextStyle } from '../text';
import { measureCtx } from '../render';
import { resolveFontFamily } from '../assets';

export const FREE_DIALOGUE = 'core.freeDialogue';

const WEIGHTS = [{ value: 'normal', label: 'weight.normal' }, { value: '600', label: 'weight.semibold' }, { value: 'bold', label: 'weight.bold' }];
const ALIGN = [{ value: 'left', label: 'align.left' }, { value: 'center', label: 'align.center' }, { value: 'right', label: 'align.right' }];

export function freeDialogueProps(transform: PropDef[]): PropDef[] {
  return [
    ...transform,
    // Content
    { key: 'speaker', type: 'string', label: 'prop.speaker', default: 'Mika', group: 'dialogue' },
    { key: 'text', type: 'text', label: 'prop.text', default: 'Say something here…', group: 'dialogue' },
    { key: 'reveal', type: 'number', label: 'prop.reveal', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'dialogue', description: 'prop.reveal.desc' },
    { key: 'typeSpeed', type: 'number', label: 'prop.typeSpeed', default: 0, min: 0, step: 5, unit: '/s', group: 'dialogue', description: 'prop.typeSpeed.desc' },
    // Box
    { key: 'shape', type: 'select', label: 'prop.boxShape', default: 'rounded', group: 'box', options: [
      { value: 'rounded', label: 'boxShape.rounded' }, { value: 'rect', label: 'boxShape.rect' }, { value: 'pill', label: 'boxShape.pill' },
      { value: 'ellipse', label: 'boxShape.ellipse' }, { value: 'bubble', label: 'boxShape.bubble' }, { value: 'thought', label: 'boxShape.thought' }, { value: 'none', label: 'boxShape.none' },
    ] },
    { key: 'width', type: 'number', label: 'prop.width', default: 560, min: 60, unit: 'px', animatable: true, group: 'box' },
    { key: 'height', type: 'number', label: 'prop.boxHeight', default: 0, min: 0, unit: 'px', animatable: true, group: 'box', description: 'prop.boxHeight.desc' },
    { key: 'padding', type: 'number', label: 'prop.padding', default: 24, min: 0, unit: 'px', animatable: true, group: 'box' },
    { key: 'radius', type: 'number', label: 'prop.radius', default: 18, min: 0, unit: 'px', animatable: true, group: 'box' },
    { key: 'fill', type: 'color', label: 'prop.fill', default: 'rgba(18,20,34,0.88)', animatable: true, group: 'box' },
    { key: 'gradient', type: 'select', label: 'prop.gradient', default: 'none', options: [{ value: 'none', label: 'gradient.none' }, { value: 'linear', label: 'gradient.linear' }], group: 'box' },
    { key: 'fill2', type: 'color', label: 'prop.fill2', default: 'rgba(40,30,70,0.9)', animatable: true, group: 'box' },
    { key: 'stroke', type: 'color', label: 'prop.stroke', default: 'rgba(255,255,255,0.35)', animatable: true, group: 'box' },
    { key: 'strokeWidth', type: 'number', label: 'prop.strokeWidth', default: 2, min: 0, animatable: true, group: 'box' },
    { key: 'boxShadowColor', type: 'color', label: 'prop.shadowColor', default: 'rgba(0,0,0,0.45)', animatable: true, group: 'box' },
    { key: 'boxShadowBlur', type: 'number', label: 'prop.shadowBlur', default: 18, min: 0, animatable: true, group: 'box' },
    { key: 'tailSide', type: 'select', label: 'prop.tailSide', default: 'bottom', group: 'box', options: [{ value: 'bottom', label: 'side.bottom' }, { value: 'top', label: 'side.top' }, { value: 'left', label: 'side.left' }, { value: 'right', label: 'side.right' }] },
    { key: 'tailPos', type: 'number', label: 'prop.tailPos', default: 0.25, min: 0, max: 1, step: 0.01, animatable: true, group: 'box' },
    { key: 'tailSize', type: 'number', label: 'prop.tailSize', default: 26, min: 0, unit: 'px', animatable: true, group: 'box' },
    // Text
    { key: 'fontFamily', type: 'font', label: 'prop.font', default: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif', group: 'text' },
    { key: 'fontSize', type: 'number', label: 'prop.fontSize', default: 28, min: 4, unit: 'px', animatable: true, group: 'text' },
    { key: 'fontWeight', type: 'select', label: 'prop.fontWeight', default: 'normal', options: WEIGHTS, group: 'text' },
    { key: 'italic', type: 'boolean', label: 'prop.italic', default: false, group: 'text' },
    { key: 'color', type: 'color', label: 'prop.color', default: '#f4f5fb', animatable: true, group: 'text' },
    { key: 'align', type: 'select', label: 'prop.align', default: 'left', options: ALIGN, group: 'text' },
    { key: 'lineHeight', type: 'number', label: 'prop.lineHeight', default: 1.45, step: 0.05, animatable: true, group: 'text' },
    { key: 'letterSpacing', type: 'number', label: 'prop.letterSpacing', default: 0, step: 0.5, animatable: true, group: 'text' },
    { key: 'textStroke', type: 'color', label: 'prop.strokeColor', default: '#000000', animatable: true, group: 'text' },
    { key: 'textStrokeWidth', type: 'number', label: 'prop.strokeWidth', default: 0, min: 0, animatable: true, group: 'text' },
    { key: 'textShadowColor', type: 'color', label: 'prop.textShadowColor', default: 'rgba(0,0,0,0.5)', animatable: true, group: 'text' },
    { key: 'textShadowBlur', type: 'number', label: 'prop.textShadowBlur', default: 0, min: 0, animatable: true, group: 'text' },
    // Name
    { key: 'namePosition', type: 'select', label: 'prop.namePosition', default: 'inside', group: 'name', options: [{ value: 'inside', label: 'namePos.inside' }, { value: 'tag', label: 'namePos.tag' }, { value: 'hidden', label: 'namePos.hidden' }] },
    { key: 'nameFont', type: 'font', label: 'prop.font', default: '', group: 'name', description: 'prop.nameFont.desc' },
    { key: 'nameSize', type: 'number', label: 'prop.fontSize', default: 24, min: 4, unit: 'px', animatable: true, group: 'name' },
    { key: 'nameColor', type: 'color', label: 'prop.color', default: '#ff9fc0', animatable: true, group: 'name' },
    { key: 'nameWeight', type: 'select', label: 'prop.fontWeight', default: 'bold', options: WEIGHTS, group: 'name' },
    { key: 'nameBackground', type: 'color', label: 'prop.nameBackground', default: 'rgba(255,111,159,0.9)', animatable: true, group: 'name' },
    { key: 'nameTextColor', type: 'color', label: 'prop.nameTagText', default: '#ffffff', animatable: true, group: 'name' },
  ];
}

interface Laid {
  w: number; h: number; pad: number;
  name: string; nameH: number; showName: 'inside' | 'tag' | 'hidden';
  style: TextStyle; full: ReturnType<typeof layoutRich>; shown: ReturnType<typeof layoutRich>; textW: number; total: number;
}

function lookup(view: any) {
  return (name: string) => {
    const v = view?.project?.variables?.find((x: any) => x.name === name);
    if (!v || !view.vars) return undefined;
    const val = view.vars.get(v.id);
    return val === undefined ? undefined : Array.isArray(val) ? val.join(', ') : String(val);
  };
}

function layout(rc: any, p: Record<string, any>): Laid {
  const ctx = measureCtx();
  const pad = Math.max(0, num(p.padding, 24));
  const w = Math.max(60, num(p.width, 560));
  const ellipse = p.shape === 'ellipse';
  // An ellipse keeps its text inside the middle of the shape.
  const inset = ellipse ? w * 0.12 : 0;
  const textW = Math.max(20, w - pad * 2 - inset * 2);
  const style: TextStyle = {
    fontFamily: resolveFontFamily(rc.project, p.fontFamily), fontSize: num(p.fontSize, 28), fontWeight: p.fontWeight || 'normal', italic: !!p.italic,
    color: p.color || '#fff', lineHeight: num(p.lineHeight, 1.45), letterSpacing: num(p.letterSpacing, 0), align: p.align || 'left',
  };
  const tokens = parseRich(interpolateVars(String(p.text ?? ''), lookup(rc.view || rc)));
  const total = countChars(tokens);
  const reveal = p.reveal === undefined ? 1 : Math.max(0, Math.min(1, num(p.reveal, 1)));
  const full = layoutRich(ctx, tokens, style, textW);
  const shown = reveal >= 1 ? full : layoutRich(ctx, tokens, style, textW, Math.floor(total * reveal));
  const name = interpolateVars(String(p.speaker ?? ''), lookup(rc.view || rc)).trim();
  const showName = (p.namePosition || 'inside') as Laid['showName'];
  const nameH = name && showName === 'inside' ? num(p.nameSize, 24) * 1.25 + 6 : 0;
  const h = num(p.height, 0) > 0 ? num(p.height) : pad * 2 + nameH + Math.max(full.height, style.fontSize * style.lineHeight) + (ellipse ? w * 0.06 : 0);
  return { w, h, pad, name, nameH, showName, style, full, shown, textW, total };
}

/** Rounded rectangle with an optional speech tail on one side (one path, so fill and outline join). */
function boxPath(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, tail: { side: string; pos: number; size: number } | null): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const base = tail ? Math.min(tail.size * 1.1, (tail.side === 'left' || tail.side === 'right' ? h : w) - r * 2 - 2) : 0;
  const along = (len: number) => Math.max(r + base / 2, Math.min(len - r - base / 2, (tail?.pos ?? 0.5) * len));
  const has = (s: string) => !!tail && tail.size > 0 && base > 2 && tail.side === s;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  if (has('top')) { const c = along(w); ctx.lineTo(c - base / 2, 0); ctx.lineTo(c - base * 0.15, -tail!.size); ctx.lineTo(c + base / 2, 0); }
  ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r);
  if (has('right')) { const c = along(h); ctx.lineTo(w, c - base / 2); ctx.lineTo(w + tail!.size, c + base * 0.15); ctx.lineTo(w, c + base / 2); }
  ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r);
  if (has('bottom')) { const c = along(w); ctx.lineTo(c + base / 2, h); ctx.lineTo(c - base * 0.15, h + tail!.size); ctx.lineTo(c - base / 2, h); }
  ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r);
  if (has('left')) { const c = along(h); ctx.lineTo(0, c + base / 2); ctx.lineTo(-tail!.size, c - base * 0.15); ctx.lineTo(0, c - base / 2); }
  ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
}

function drawBox(ctx: CanvasRenderingContext2D, L: Laid, p: Record<string, any>): void {
  const { w, h } = L;
  const shape = p.shape || 'rounded';
  if (shape === 'none') return;
  const fill = (): void => {
    if (p.gradient === 'linear') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, p.fill || 'transparent');
      g.addColorStop(1, p.fill2 || p.fill || 'transparent');
      ctx.fillStyle = g;
    } else ctx.fillStyle = p.fill || 'transparent';
    ctx.fill();
  };
  const outline = (): void => {
    const sw = num(p.strokeWidth, 0);
    if (sw <= 0) return;
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = sw;
    ctx.strokeStyle = p.stroke || '#fff';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  ctx.save();
  if (num(p.boxShadowBlur) > 0) { ctx.shadowColor = p.boxShadowColor || 'rgba(0,0,0,.4)'; ctx.shadowBlur = num(p.boxShadowBlur); ctx.shadowOffsetY = num(p.boxShadowBlur) / 4; }
  const tail = { side: p.tailSide || 'bottom', pos: num(p.tailPos, 0.25), size: num(p.tailSize, 26) };
  if (shape === 'ellipse') { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); fill(); outline(); }
  else if (shape === 'thought') {
    boxPath(ctx, w, h, Math.min(h / 2, Math.max(num(p.radius, 18), 40)), null); fill(); outline();
    // Little puffs toward the speaker.
    const dir = tail.side;
    const start = dir === 'left' || dir === 'right' ? { x: dir === 'left' ? 0 : w, y: Math.max(0, Math.min(h, tail.pos * h)) } : { x: Math.max(0, Math.min(w, tail.pos * w)), y: dir === 'top' ? 0 : h };
    const step = { x: dir === 'left' ? -1 : dir === 'right' ? 1 : 0, y: dir === 'top' ? -1 : dir === 'bottom' ? 1 : 0 };
    const s = Math.max(6, tail.size);
    [[0.55, 0.32], [1.15, 0.2], [1.6, 0.12]].forEach(([d, rr]) => {
      ctx.save(); ctx.beginPath(); ctx.arc(start.x + step.x * s * d, start.y + step.y * s * d, s * rr, 0, Math.PI * 2); fill(); outline(); ctx.restore();
    });
  } else {
    const r = shape === 'rect' ? 0 : shape === 'pill' ? h / 2 : num(p.radius, 18);
    boxPath(ctx, w, h, r, shape === 'bubble' ? tail : null);
    fill(); outline();
  }
  ctx.restore();
}

export function registerFreeDialogue(engine: Engine, reg: (d: LayerTypeDef) => void, transform: PropDef[]): void {
  reg({
    id: FREE_DIALOGUE, label: 'layer.freeDialogue', icon: 'quote', category: 'text', visual: true,
    props: freeDialogueProps(transform),
    size(_l, p, rc) { const L = layout(rc, p); return { width: L.w, height: L.h }; },
    step(state, dt, ctx) {
      // Typewriter: new text types itself at typeSpeed characters per second.
      const speed = num(state.typeSpeed, 0);
      const text = String(state.text ?? '');
      if (speed <= 0) { state._typed = text; return; }
      if (state._typed !== text) { state._typed = text; state.reveal = 0; }
      const r = num(state.reveal, 1);
      if (r >= 1) return;
      const total = Math.max(1, countChars(parseRich(text)));
      state.reveal = Math.min(1, r + (speed * dt) / total);
      if (state.reveal >= 1) ctx.emit({ type: 'dialogue.typed', layerId: ctx.layer.id });
    },
    draw(rc, _l, p) {
      const L = layout(rc, p);
      const ctx = rc.ctx as CanvasRenderingContext2D;
      drawBox(ctx, L, p);
      const inset = p.shape === 'ellipse' ? L.w * 0.12 : 0;
      const top = p.shape === 'ellipse' ? Math.max(L.pad, (L.h - L.nameH - L.full.height) / 2) : L.pad;
      // Name
      if (L.name && L.showName !== 'hidden') {
        const size = num(p.nameSize, 24);
        const family = resolveFontFamily(rc.project, p.nameFont || p.fontFamily);
        ctx.save();
        ctx.font = `${p.nameWeight || 'bold'} ${size}px ${family}`;
        ctx.textBaseline = 'top';
        if (L.showName === 'tag') {
          const tw = ctx.measureText(L.name).width + size * 1.1;
          const th = size * 1.55;
          const x = Math.min(L.w - tw, Math.max(0, L.pad * 0.6));
          ctx.beginPath();
          const r = th / 2.4;
          ctx.moveTo(x + r, -th * 0.62); ctx.arcTo(x + tw, -th * 0.62, x + tw, th * 0.38, r); ctx.arcTo(x + tw, th * 0.38, x, th * 0.38, r); ctx.arcTo(x, th * 0.38, x, -th * 0.62, r); ctx.arcTo(x, -th * 0.62, x + tw, -th * 0.62, r);
          ctx.closePath();
          ctx.fillStyle = p.nameBackground || 'rgba(255,111,159,0.9)';
          ctx.fill();
          ctx.fillStyle = p.nameTextColor || '#fff';
          ctx.fillText(L.name, x + size * 0.55, -th * 0.62 + (th - size) / 2);
        } else {
          const ax = p.align === 'center' ? L.w / 2 : p.align === 'right' ? L.w - L.pad - inset : L.pad + inset;
          ctx.textAlign = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left';
          ctx.fillStyle = p.nameColor || '#ff9fc0';
          ctx.fillText(L.name, ax, top);
        }
        ctx.restore();
      }
      // Text
      ctx.save();
      ctx.translate(L.pad + inset, top + (L.showName === 'inside' && L.name ? L.nameH : 0));
      if (num(p.textShadowBlur) > 0) { ctx.shadowColor = p.textShadowColor || 'rgba(0,0,0,.5)'; ctx.shadowBlur = num(p.textShadowBlur); ctx.shadowOffsetY = num(p.textShadowBlur) / 4; }
      drawRich(ctx, L.shown, L.style, L.textW, rc.time, { stroke: p.textStroke, strokeWidth: num(p.textStrokeWidth) });
      ctx.restore();
    },
  });
}
