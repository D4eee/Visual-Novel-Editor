/**
 * Character rigs: pose a skeleton (rest pose + expression + motion at a time) and draw its
 * image parts. Used by character elements, the Character studio preview and exported games.
 */
import type { Character, CharacterExpression, CharacterMotion, CharacterRig, RigAttachment, RigTrack } from '@vne/core';

export interface BonePose { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
export interface Pose {
  bones: Map<string, BonePose>;
  parts: Map<string, { attachment: string | null; opacity: number }>;
}
/** 2D affine matrix [a, b, c, d, e, f] (canvas order). */
export type Mat = [number, number, number, number, number, number];

const EASE: Record<string, (u: number) => number> = {
  linear: (u) => u,
  step: () => 0,
  hold: () => 0,
  easeIn: (u) => u * u * u,
  easeOut: (u) => 1 - Math.pow(1 - u, 3),
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
};

export function motionDuration(m: CharacterMotion | null | undefined): number {
  if (!m) return 0;
  if (m.kind === 'frames') return m.duration || (m.frames?.length || 0) / Math.max(1, m.fps || 12);
  let end = m.duration || 0;
  for (const tr of m.tracks || []) for (const k of tr.keys) if (k.t > end) end = k.t;
  return end;
}

/** A rig track's value at time t (keys sorted by time). */
export function sampleRigTrack(tr: RigTrack, t: number): any {
  const ks = tr.keys;
  if (!ks.length) return undefined;
  // Before the first key an image swap keeps the setup image; numbers hold the first value.
  if (t < ks[0].t) return tr.prop === 'attachment' ? undefined : ks[0].v;
  if (t <= ks[0].t) return ks[0].v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t < b.t) {
      if (typeof a.v !== 'number' || typeof b.v !== 'number' || a.ease === 'step' || a.ease === 'hold') return a.v;
      const u = (EASE[a.ease || 'linear'] || EASE.linear)((t - a.t) / Math.max(1e-6, b.t - a.t));
      return a.v + (b.v - a.v) * u;
    }
  }
  return ks[ks.length - 1].v;
}

/** Time inside a motion: loops, or holds its end. */
export function motionLocalTime(m: CharacterMotion, t: number): number {
  const d = motionDuration(m);
  if (d <= 0) return 0;
  return m.loop ? ((t % d) + d) % d : Math.min(d, Math.max(0, t));
}

/** Rest pose, then the expression, then the motion at time `t` (seconds into the motion). */
export function rigPose(rig: CharacterRig, motion?: CharacterMotion | null, t = 0, expression?: CharacterExpression | null): Pose {
  const bones = new Map<string, BonePose>();
  for (const b of rig.bones) bones.set(b.id, { x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY });
  const parts = new Map<string, { attachment: string | null; opacity: number }>();
  for (const p of rig.parts) parts.set(p.id, { attachment: p.attachment, opacity: p.opacity ?? 1 });
  if (expression) {
    for (const [id, o] of Object.entries(expression.bones || {})) {
      const b = bones.get(id);
      if (!b || !o) continue;
      b.x += o.x || 0; b.y += o.y || 0; b.rotation += o.rotation || 0;
      b.scaleX *= o.scaleX ?? 1; b.scaleY *= o.scaleY ?? 1;
    }
    for (const [id, o] of Object.entries(expression.parts || {})) {
      const p = parts.get(id);
      if (!p || !o) continue;
      if (o.attachment !== undefined) p.attachment = o.attachment;
      if (o.opacity !== undefined) p.opacity = o.opacity;
    }
  }
  if (motion && motion.kind === 'rig') {
    const lt = motionLocalTime(motion, t);
    for (const tr of motion.tracks || []) {
      const v = sampleRigTrack(tr, lt);
      if (v === undefined) continue;
      if (tr.target === 'bone') {
        const b = bones.get(tr.id);
        if (!b) continue;
        if (tr.prop === 'x') b.x += Number(v) || 0;
        else if (tr.prop === 'y') b.y += Number(v) || 0;
        else if (tr.prop === 'rotation') b.rotation += Number(v) || 0;
        else if (tr.prop === 'scaleX') b.scaleX *= Number.isFinite(Number(v)) ? Number(v) : 1;
        else if (tr.prop === 'scaleY') b.scaleY *= Number.isFinite(Number(v)) ? Number(v) : 1;
      } else {
        const p = parts.get(tr.id);
        if (!p) continue;
        if (tr.prop === 'attachment') p.attachment = v == null || v === '' ? null : String(v);
        else if (tr.prop === 'opacity') p.opacity = Number(v);
      }
    }
  }
  return { bones, parts };
}

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const local = (x: number, y: number, rotDeg: number, sx: number, sy: number): Mat => {
  const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
};
export const invert = (m: Mat): Mat => {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};
export const apply = (m: Mat, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** World matrices of the bones (rig space: the box, origin applied). */
export function boneWorlds(rig: CharacterRig, pose: Pose): Map<string, Mat> {
  const out = new Map<string, Mat>();
  const root: Mat = [1, 0, 0, 1, rig.origin?.x ?? rig.width / 2, rig.origin?.y ?? rig.height];
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const visit = (id: string, depth = 0): Mat => {
    const m = out.get(id);
    if (m) return m;
    const b = byId.get(id)!;
    const p = pose.bones.get(id)!;
    const parent = b.parent && byId.has(b.parent) && depth < 64 ? visit(b.parent, depth + 1) : root;
    const w = mul(parent, local(p.x, p.y, p.rotation, p.scaleX, p.scaleY));
    out.set(id, w);
    return w;
  };
  for (const b of rig.bones) visit(b.id);
  out.set('', root);
  return out;
}

export function attachmentMatrix(worlds: Map<string, Mat>, bone: string | null, a: RigAttachment): Mat {
  return mul(worlds.get(bone || '') || worlds.get('')!, local(a.x, a.y, a.rotation, a.scaleX, a.scaleY));
}

/** Draw a posed rig into the box (0, 0)–(rig.width, rig.height) of the current transform. */
export function drawRig(ctx: CanvasRenderingContext2D, rig: CharacterRig, pose: Pose, image: (assetId: string) => CanvasImageSource | null, opts: { opacity?: number; outline?: string | null; selected?: string | null } = {}): void {
  const worlds = boneWorlds(rig, pose);
  const base = ctx.getTransform();
  for (const part of rig.parts) {
    const ps = pose.parts.get(part.id);
    if (!ps || !ps.attachment || ps.opacity <= 0) continue;
    const a = part.attachments.find((x) => x.name === ps.attachment);
    if (!a) continue;
    const img = a.assetId ? image(a.assetId) : null;
    const m = attachmentMatrix(worlds, part.bone, a);
    ctx.setTransform(base.multiply(new DOMMatrix(m)));
    ctx.globalAlpha = (opts.opacity ?? 1) * ps.opacity;
    const w = a.width, h = a.height;
    if (img) drawAttachmentImage(ctx, img, a, w, h);
    else { ctx.fillStyle = 'rgba(140,160,220,.35)'; ctx.fillRect(-w / 2, -h / 2, w, h); }
    if (opts.outline && opts.selected === part.id) { ctx.strokeStyle = opts.outline; ctx.lineWidth = 2 / Math.max(0.01, Math.hypot(m[0], m[1])); ctx.strokeRect(-w / 2, -h / 2, w, h); }
  }
  ctx.setTransform(base);
  ctx.globalAlpha = 1;
}

function drawAttachmentImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource, a: RigAttachment, w: number, h: number) {
  const r = a.region;
  if (!r) { ctx.drawImage(img, -w / 2, -h / 2, w, h); return; }
  // Trimmed atlas pieces sit inside their original size (offsets measured from the bottom-left).
  const ow = r.ow || r.w, oh = r.oh || r.h;
  const sx = w / ow, sy = h / oh;
  const dx = -w / 2 + (r.ox || 0) * sx;
  const dy = -h / 2 + (oh - (r.oy || 0) - r.h) * sy;
  const dw = r.w * sx, dh = r.h * sy;
  if (!r.rotated) { ctx.drawImage(img, r.x, r.y, r.w, r.h, dx, dy, dw, dh); return; }
  // Rotated pieces are stored turned 90° clockwise on the page.
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, r.x, r.y, r.h, r.w, -dh / 2, -dw / 2, dh, dw);
  ctx.restore();
}

/** The topmost part under (x, y) in rig-box coordinates. */
export function hitRigPart(rig: CharacterRig, pose: Pose, x: number, y: number): string | null {
  const worlds = boneWorlds(rig, pose);
  for (let i = rig.parts.length - 1; i >= 0; i--) {
    const part = rig.parts[i];
    const ps = pose.parts.get(part.id);
    if (!ps?.attachment) continue;
    const a = part.attachments.find((q) => q.name === ps.attachment);
    if (!a) continue;
    const p = apply(invert(attachmentMatrix(worlds, part.bone, a)), x, y);
    if (Math.abs(p.x) <= a.width / 2 && Math.abs(p.y) <= a.height / 2) return part.id;
  }
  return null;
}

/** What a character element shows at a time: a rig pose, an image-sequence frame or a portrait. */
export function characterFrame(ch: Character, motionId: string | null | undefined, expressionId: string | null | undefined, t: number):
  { kind: 'rig'; pose: Pose } | { kind: 'frame'; assetId: string | null } | { kind: 'portrait'; portraitId: string | null } {
  const motions = ch.motions || [];
  let motion = motions.find((m) => m.id === motionId) || null;
  let mt = t;
  // A motion that does not loop hands over to the idle motion when it ends.
  if (motion && !motion.loop) {
    const d = motionDuration(motion);
    const idle = motions.find((m) => m.id === ch.defaultMotion && m.id !== motion!.id);
    if (idle && t > d) { mt = t - d; motion = idle; }
  }
  if (!motion && ch.defaultMotion) motion = motions.find((m) => m.id === ch.defaultMotion) || null;
  const expression = (ch.expressions || []).find((e) => e.id === expressionId) || null;
  if (motion?.kind === 'frames' && motion.frames?.length) {
    const lt = motionLocalTime(motion, mt);
    const i = Math.min(motion.frames.length - 1, Math.floor(lt * Math.max(1, motion.fps || 12)));
    return { kind: 'frame', assetId: motion.frames[i] };
  }
  if (ch.rig && ch.rig.parts.length) return { kind: 'rig', pose: rigPose(ch.rig, motion, mt, expression) };
  return { kind: 'portrait', portraitId: expression?.portraitId ?? null };
}
