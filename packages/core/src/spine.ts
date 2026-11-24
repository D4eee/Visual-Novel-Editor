/**
 * Spine import: a skeleton exported from Spine as JSON (3.8 or 4.x), with its texture atlas,
 * becomes a character rig with motions. Bones, slots with region attachments, attachment
 * swaps, rotate / translate / scale and alpha timelines are kept. Meshes are drawn as plain
 * images over their setup-pose bounds; deform, shear, IK and other constraints are dropped
 * (reported as warnings). Spine is y-up; rigs are y-down, so y and angles are mirrored.
 *
 * Attachment images are given as `page:<atlas page file>` (with a region) or, without an
 * atlas, `file:<image path>`; the importer replaces them with asset ids.
 */
import type { CharacterMotion, CharacterRig, RigAttachment, RigBone, RigPart, RigTrack } from './types';

export interface AtlasRegion { page: string; x: number; y: number; w: number; h: number; rotated: boolean; ox: number; oy: number; ow: number; oh: number }

export function parseSpineAtlas(text: string): Map<string, AtlasRegion> {
  const out = new Map<string, AtlasRegion>();
  const lines = text.replace(/\r/g, '').split('\n');
  let page = '';
  let region: (AtlasRegion & { name: string }) | null = null;
  let pageHeader = false;
  const flush = () => { if (region) { if (!region.ow) { region.ow = region.w; region.oh = region.h; } out.set(region.name, region); } region = null; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); pageHeader = false; page = ''; continue; }
    const kv = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      // A name line: the first one after a blank line is the page, the others are regions.
      flush();
      if (!page) { page = line; pageHeader = true; continue; }
      pageHeader = false;
      region = { name: line, page, x: 0, y: 0, w: 0, h: 0, rotated: false, ox: 0, oy: 0, ow: 0, oh: 0 };
      continue;
    }
    const [key, val] = [kv[1].toLowerCase(), kv[2]];
    const nums = val.split(',').map((v) => Number(v.trim()));
    if (pageHeader || !region) continue; // size, format, filter, repeat, pma, scale of the page
    if (key === 'bounds') [region.x, region.y, region.w, region.h] = nums;
    else if (key === 'xy') [region.x, region.y] = nums;
    else if (key === 'size') [region.w, region.h] = nums;
    else if (key === 'rotate') region.rotated = val.trim() === 'true' || val.trim() === '90';
    else if (key === 'offsets') [region.ox, region.oy, region.ow, region.oh] = nums;
    else if (key === 'offset') [region.ox, region.oy] = nums;
    else if (key === 'orig') [region.ow, region.oh] = nums;
  }
  flush();
  return out;
}

export interface SpineImport { rig: CharacterRig; motions: CharacterMotion[]; images: string[]; warnings: string[] }

export function importSpine(json: any, atlasText: string | null, newId: (prefix: string) => string): SpineImport {
  const warnings = new Set<string>();
  const atlas = atlasText ? parseSpineAtlas(atlasText) : null;
  const sk = json.skeleton || {};
  const boneIds = new Map<string, string>();
  const bones: RigBone[] = (json.bones || []).map((b: any) => {
    const id = newId('bon');
    boneIds.set(b.name, id);
    if (b.shearX || b.shearY) warnings.add('shear');
    if (b.transform && b.transform !== 'normal') warnings.add('inherit');
    return { id, name: String(b.name), parent: null, x: Number(b.x) || 0, y: -(Number(b.y) || 0), rotation: -(Number(b.rotation) || 0), scaleX: b.scaleX ?? 1, scaleY: b.scaleY ?? 1, length: Number(b.length) || 0 };
  });
  (json.bones || []).forEach((b: any, i: number) => { if (b.parent) bones[i].parent = boneIds.get(b.parent) ?? null; });
  if (json.ik?.length || json.transform?.length || json.path?.length || json.physics?.length) warnings.add('constraints');

  // Skins: 3.x { default: { slot: { att: {...} } } }, 4.x [{ name, attachments: {...} }]
  const skinList: any[] = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins || {}).map(([name, attachments]) => ({ name, attachments }));
  const skin = skinList.find((s) => s.name === 'default') || skinList[0] || { attachments: {} };
  if (skinList.length > 1) warnings.add('skins');
  const images = new Set<string>();
  const worldOf = setupWorlds(json.bones || []);

  const partIds = new Map<string, string>();
  const parts: RigPart[] = (json.slots || []).map((sl: any) => {
    const id = newId('prt');
    partIds.set(sl.name, id);
    const atts: RigAttachment[] = [];
    for (const [attName, raw] of Object.entries<any>(skin.attachments?.[sl.name] || {})) {
      const type = raw.type || 'region';
      const path = String(raw.path || raw.name || attName);
      let a: RigAttachment | null = null;
      if (type === 'region') {
        a = { name: attName, assetId: null, x: Number(raw.x) || 0, y: -(Number(raw.y) || 0), rotation: -(Number(raw.rotation) || 0), scaleX: raw.scaleX ?? 1, scaleY: raw.scaleY ?? 1, width: Number(raw.width) || 0, height: Number(raw.height) || 0 };
      } else if (type === 'mesh' || type === 'linkedmesh') {
        warnings.add('mesh');
        const b = meshBounds(raw, json.bones || [], sl.bone, worldOf);
        if (b) a = { name: attName, assetId: null, x: b.x, y: -b.y, rotation: 0, scaleX: 1, scaleY: 1, width: b.w, height: b.h };
        else if (raw.width && raw.height) a = { name: attName, assetId: null, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: raw.width, height: raw.height };
      } else continue; // bounding boxes, clipping, paths, points: not drawn
      if (!a) continue;
      const reg = atlas?.get(path);
      if (reg) {
        a.assetId = `page:${reg.page}`;
        a.region = { x: reg.x, y: reg.y, w: reg.w, h: reg.h, rotated: reg.rotated, ox: reg.ox, oy: reg.oy, ow: reg.ow, oh: reg.oh };
        if (!a.width) { a.width = reg.ow; a.height = reg.oh; }
        images.add(a.assetId);
      } else {
        a.assetId = `file:${path}`;
        images.add(a.assetId);
      }
      atts.push(a);
    }
    return { id, name: String(sl.name), bone: boneIds.get(sl.bone) ?? null, attachments: atts, attachment: sl.attachment ?? null, opacity: alphaOf(sl.color) };
  });

  const motions: CharacterMotion[] = [];
  for (const [name, anim] of Object.entries<any>(json.animations || {})) {
    const tracks: RigTrack[] = [];
    let end = 0;
    const keys = (arr: any[], get: (k: any) => any, base = 0) => arr.map((k: any) => { const t = Number(k.time) || 0; end = Math.max(end, t); return { t, v: get(k) + base, ease: easeOf(k.curve) }; });
    for (const [boneName, tl] of Object.entries<any>(anim.bones || {})) {
      const id = boneIds.get(boneName);
      if (!id) continue;
      for (const [kind, arr] of Object.entries<any>(tl)) {
        if (!Array.isArray(arr) || !arr.length) continue;
        if (kind === 'rotate') tracks.push({ target: 'bone', id, prop: 'rotation', keys: keys(arr, (k) => -(Number(k.value ?? k.angle) || 0)) });
        else if (kind === 'translate') {
          tracks.push({ target: 'bone', id, prop: 'x', keys: keys(arr, (k) => Number(k.x) || 0) });
          tracks.push({ target: 'bone', id, prop: 'y', keys: keys(arr, (k) => -(Number(k.y) || 0)) });
        } else if (kind === 'translatex') tracks.push({ target: 'bone', id, prop: 'x', keys: keys(arr, (k) => Number(k.value) || 0) });
        else if (kind === 'translatey') tracks.push({ target: 'bone', id, prop: 'y', keys: keys(arr, (k) => -(Number(k.value) || 0)) });
        else if (kind === 'scale') {
          tracks.push({ target: 'bone', id, prop: 'scaleX', keys: keys(arr, (k) => k.x ?? 1) });
          tracks.push({ target: 'bone', id, prop: 'scaleY', keys: keys(arr, (k) => k.y ?? 1) });
        } else if (kind === 'scalex') tracks.push({ target: 'bone', id, prop: 'scaleX', keys: keys(arr, (k) => k.value ?? 1) });
        else if (kind === 'scaley') tracks.push({ target: 'bone', id, prop: 'scaleY', keys: keys(arr, (k) => k.value ?? 1) });
        else warnings.add('shear');
      }
    }
    for (const [slotName, tl] of Object.entries<any>(anim.slots || {})) {
      const id = partIds.get(slotName);
      if (!id) continue;
      if (Array.isArray(tl.attachment)) tracks.push({ target: 'part', id, prop: 'attachment', keys: tl.attachment.map((k: any) => { const t = Number(k.time) || 0; end = Math.max(end, t); return { t, v: k.name ?? null, ease: 'step' }; }) });
      const col = tl.rgba || tl.color || tl.alpha;
      if (Array.isArray(col)) tracks.push({ target: 'part', id, prop: 'opacity', keys: col.map((k: any) => { const t = Number(k.time) || 0; end = Math.max(end, t); return { t, v: tl.alpha ? Number(k.value ?? 1) : alphaOf(k.color), ease: easeOf(k.curve) }; }) });
    }
    if (anim.deform || anim.drawOrder || anim.draworder || anim.ik || anim.transform || anim.path) warnings.add('timelines');
    motions.push({ id: newId('mot'), name, kind: 'rig', duration: Math.round(end * 1000) / 1000, loop: /idle|loop|walk|run|breath|待机|循环/i.test(name), tracks });
  }

  const width = Math.max(1, Math.round(Number(sk.width) || 512));
  const height = Math.max(1, Math.round(Number(sk.height) || 512));
  const rig: CharacterRig = {
    width, height,
    // Spine bounds are y-up from the skeleton origin: the origin sits at (-x, height + y) in the box.
    origin: { x: Math.round(-(Number(sk.x) || -width / 2)), y: Math.round(height + (Number(sk.y) || 0)) },
    bones, parts, source: 'spine',
  };
  return { rig, motions, images: [...images], warnings: [...warnings] };
}

function alphaOf(color: unknown): number {
  if (typeof color !== 'string' || color.length < 8) return 1;
  return parseInt(color.slice(6, 8), 16) / 255;
}

function easeOf(curve: unknown): string {
  if (curve === 'stepped') return 'step';
  if (curve === undefined || curve === null || curve === 'linear') return 'linear';
  return 'easeInOut'; // bezier curves: a smooth ease is the closest built-in
}

/** Setup-pose world transforms of Spine bones (y-up), for placing meshes. */
function setupWorlds(bones: any[]): Map<string, { a: number; b: number; c: number; d: number; x: number; y: number }> {
  const out = new Map<string, any>();
  for (const b of bones) {
    const r = ((Number(b.rotation) || 0) * Math.PI) / 180;
    const sx = b.scaleX ?? 1, sy = b.scaleY ?? 1;
    const la = Math.cos(r) * sx, lc = -Math.sin(r) * sy, lb = Math.sin(r) * sx, ld = Math.cos(r) * sy;
    const p = b.parent ? out.get(b.parent) : { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
    const x = Number(b.x) || 0, y = Number(b.y) || 0;
    out.set(b.name, { a: p.a * la + p.c * lb, c: p.a * lc + p.c * ld, b: p.b * la + p.d * lb, d: p.b * lc + p.d * ld, x: p.a * x + p.c * y + p.x, y: p.b * x + p.d * y + p.y });
  }
  return out;
}

/** A mesh's setup-pose bounding box in its slot bone's space (y-up). */
function meshBounds(raw: any, bones: any[], slotBone: string, worlds: Map<string, any>): { x: number; y: number; w: number; h: number } | null {
  const v: number[] = raw.vertices || [];
  const uvs: number[] = raw.uvs || [];
  if (!v.length || !uvs.length) return null;
  const pts: { x: number; y: number }[] = [];
  if (v.length === uvs.length) for (let i = 0; i < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
  else {
    // Weighted: [count, bone, x, y, weight, …] per vertex, in world space after binding.
    for (let i = 0; i < v.length;) {
      const n = v[i++];
      let wx = 0, wy = 0;
      for (let k = 0; k < n; k++, i += 4) {
        const m = worlds.get(bones[v[i]]?.name);
        if (!m) continue;
        wx += (m.a * v[i + 1] + m.c * v[i + 2] + m.x) * v[i + 3];
        wy += (m.b * v[i + 1] + m.d * v[i + 2] + m.y) * v[i + 3];
      }
      const s = worlds.get(slotBone);
      if (s) {
        const det = s.a * s.d - s.b * s.c || 1;
        const dx = wx - s.x, dy = wy - s.y;
        pts.push({ x: (s.d * dx - s.c * dy) / det, y: (s.a * dy - s.b * dx) / det });
      }
    }
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
