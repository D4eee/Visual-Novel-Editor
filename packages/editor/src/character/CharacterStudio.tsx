/**
 * Character studio: build a character's skeleton (bones with image parts), its motions
 * (rig keyframes or image sequences) and expressions, or import them from Spine.
 * Character elements play motions; Interactions (Play motion / Set expression) and the
 * timeline (the element's Motion and Expression properties) choose what plays.
 */
import { useEffect, useRef, useState } from 'react';
import type { Asset, Character, CharacterExpression, CharacterMotion, CharacterRig, RigAttachment, RigBone, RigPart, RigTrack } from '@vne/core';
import { importSpine, newId } from '@vne/core';
import { boneWorlds, characterFrame, drawRig, hitRigPart, motionDuration, rigInvert, rigPose, sampleRigTrack } from '@vne/runtime';
import type { Pose, RigMat } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { store, useSession, useStore, useT } from '../state/store';
import type { StudioTab } from '../state/store';
import { Button, Field, IconButton, NumberInput, Section, Select, Tabs, TextInput, Toggle, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { openMenu } from '../ui/Menu';
import { AssetPicker } from '../inspect/AssetPicker';
import { call, fileToBase64 } from '../host';
import { saveCharacterPreset } from '../library/library';

type Sel = { kind: 'bone' | 'part'; id: string } | null;
type BoneProp = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY';
const BONE_PROPS: BoneProp[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];
const EASE_LABEL: Record<string, string> = { linear: 'ease.linear', easeIn: 'ease.in', easeOut: 'ease.out', easeInOut: 'ease.inOut', step: 'ease.step' };

export function CharacterStudioHost() {
  const st = useStore();
  const s = st.session;
  if (!st.studio || !s) return null;
  if (!s.project.characters.some((c) => c.id === st.studio!.characterId)) return null;
  return <CharacterStudio key={st.studio.characterId} session={s} characterId={st.studio.characterId} initialTab={st.studio.tab} onClose={() => store.openStudio(null)} />;
}

/* ------------------------------------------------------------------ helpers */

const natural = (project: { assets: Asset[] }, id: string | null) => {
  const a = id ? project.assets.find((x) => x.id === id) : null;
  const w = Number(a?.meta?.width), h = Number(a?.meta?.height);
  return w && h ? { width: w, height: h } : null;
};

function newBone(name: string, parent: string | null, x = 0, y = 0): RigBone {
  return { id: newId('bon'), name, parent, x, y, rotation: 0, scaleX: 1, scaleY: 1, length: 60 };
}

function emptyRig(width: number, height: number): CharacterRig {
  const root = newBone('root', null);
  return { width, height, origin: { x: Math.round(width / 2), y: height }, bones: [root], parts: [], source: 'editor' };
}

function upsertKey(m: CharacterMotion, target: 'bone' | 'part', id: string, prop: RigTrack['prop'], t: number, v: any, ease = 'easeInOut') {
  m.tracks ||= [];
  let tr = m.tracks.find((x) => x.target === target && x.id === id && x.prop === prop);
  if (!tr) { tr = { target, id, prop, keys: [] }; m.tracks.push(tr); }
  const k = tr.keys.find((x) => Math.abs(x.t - t) < 1e-3);
  if (k) k.v = v;
  else { tr.keys.push({ t: Math.round(t * 1000) / 1000, v, ease: prop === 'attachment' ? 'step' : ease }); tr.keys.sort((a, b) => a.t - b.t); }
  if (t > m.duration) m.duration = Math.round(t * 1000) / 1000;
}

function removeKey(m: CharacterMotion, target: string, id: string, prop: string, t: number) {
  const tr = m.tracks?.find((x) => x.target === target && x.id === id && x.prop === prop);
  if (!tr) return;
  tr.keys = tr.keys.filter((k) => Math.abs(k.t - t) >= 1e-3);
  if (!tr.keys.length) m.tracks = m.tracks!.filter((x) => x !== tr);
}

const neutral = (p: string) => (p === 'scaleX' || p === 'scaleY' || p === 'opacity' ? 1 : 0);

/* ------------------------------------------------------------------ studio */

export function CharacterStudio({ session, characterId, initialTab, onClose }: { session: ProjectSession; characterId: string; initialTab?: StudioTab; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const ch = session.project.characters.find((c) => c.id === characterId)!;
  const rig = ch.rig && ch.rig.bones.length ? ch.rig : null;
  const [tab, setTab] = useState<StudioTab>(initialTab || (rig ? 'rig' : 'import'));
  const [sel, setSel] = useState<Sel>(null);
  const [motionId, setMotionId] = useState<string | null>(() => ch.motions?.[0]?.id || null);
  const [exprId, setExprId] = useState<string | null>(() => ch.expressions?.[0]?.id || null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const motion = (ch.motions || []).find((m) => m.id === motionId) || null;
  const expression = (ch.expressions || []).find((e) => e.id === exprId) || null;

  const upd = (label: string, fn: (c: Character) => void, mergeKey?: string) =>
    session.update(label, (d) => { const c = d.characters.find((x) => x.id === characterId); if (c) fn(c); }, mergeKey ? { mergeKey } : undefined);

  // What the preview shows: the motion only on the Motions tab, the expression on Expressions (and Motions).
  const showMotion = tab === 'motions' ? motion : null;
  const showExpr = tab === 'expressions' || tab === 'motions' ? expression : null;
  const dur = motionDuration(showMotion);

  // Playback
  useEffect(() => {
    if (!playing || !showMotion) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setTime((x) => { const d = motionDuration(showMotion) || 1; let n = x + dt; if (n > d) n = showMotion.loop ? n % d : d; return n; });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, showMotion?.id]);
  useEffect(() => { setPlaying(false); setTime(0); }, [motionId, tab]);

  const tabs: { id: StudioTab; label: string; icon: string }[] = [
    { id: 'rig', label: t('studio.tab.rig'), icon: 'bone' },
    { id: 'motions', label: t('studio.tab.motions'), icon: 'motion' },
    { id: 'expressions', label: t('studio.tab.expressions'), icon: 'smile' },
    { id: 'import', label: t('studio.tab.import'), icon: 'upload' },
  ];
  return (
    <Modal className="studio-modal" width={1120} icon={<Icon name="user" size={16} />} onClose={onClose}
      title={<>{t('studio.title')} · {ch.name}</>}
      footer={<>
        <span className="muted small grow">{rig ? t('studio.summary', { bones: rig.bones.length, parts: rig.parts.length, motions: (ch.motions || []).length, expressions: (ch.expressions || []).length }) : t('studio.noRigShort')}</span>
        <Button icon="bookmarkPlus" kind="ghost" onClick={() => saveCharacterPreset(session, ch.id)}>{t('lib.saveCharacter')}</Button>
        <Button kind="primary" onClick={onClose}>{t('common.done')}</Button>
      </>}>
      <div className="studio">
        <div className="studio-stage">
          <RigCanvas session={session} ch={ch} motion={showMotion} expression={showExpr} time={time} sel={sel} tab={tab}
            onSelect={setSel} onEdit={(label, fn, mk) => upd(label, fn, mk)} />
          {tab === 'motions' && showMotion && (
            <div className="studio-transport">
              <IconButton icon={playing ? 'pause' : 'play'} title={playing ? t('studio.pause') : t('studio.play')} onClick={() => { if (!playing && time >= dur) setTime(0); setPlaying(!playing); }} />
              <input type="range" min={0} max={Math.max(0.01, dur)} step={0.01} value={Math.min(time, dur)} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} aria-label={t('studio.time')} />
              <span className="mono small">{time.toFixed(2)} / {dur.toFixed(2)}s</span>
            </div>
          )}
          <p className="muted small studio-hint">{t(tab === 'rig' ? 'studio.hint.rig' : tab === 'motions' ? 'studio.hint.motions' : tab === 'expressions' ? 'studio.hint.expressions' : 'studio.hint.import')}</p>
        </div>
        <div className="studio-side">
          <Tabs<StudioTab> className="insp-tabs" value={tab} onChange={setTab} tabs={tabs} />
          <div className="studio-panel">
            {tab === 'rig' && <RigPanel session={session} ch={ch} sel={sel} setSel={setSel} upd={upd} onGoImport={() => setTab('import')} />}
            {tab === 'motions' && <MotionsPanel session={session} ch={ch} motion={motion} setMotionId={setMotionId} sel={sel} setSel={setSel} time={time} setTime={setTime} upd={upd} />}
            {tab === 'expressions' && <ExpressionsPanel session={session} ch={ch} expression={expression} setExprId={setExprId} sel={sel} upd={upd} />}
            {tab === 'import' && <ImportPanel session={session} ch={ch} upd={upd} onDone={(next) => { setTab(next.tab); if (next.motionId) setMotionId(next.motionId); }} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

type Upd = (label: string, fn: (c: Character) => void, mergeKey?: string) => void;

/* ------------------------------------------------------------------ canvas */

function RigCanvas({ session, ch, motion, expression, time, sel, tab, onSelect, onEdit }: {
  session: ProjectSession; ch: Character; motion: CharacterMotion | null; expression: CharacterExpression | null; time: number; sel: Sel; tab: StudioTab;
  onSelect: (s: Sel) => void; onEdit: Upd;
}) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ ch, motion, expression, time, sel, tab });
  live.current = { ch, motion, expression, time, sel, tab };
  const view = useRef({ k: 1, ox: 0, oy: 0 });

  // Redraw every frame while open (images arrive asynchronously, playback moves time).
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = ref.current;
      if (cv) {
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        const ctx = cv.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        paint(ctx, w, h);
      }
      raf = requestAnimationFrame(draw);
    };
    const paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const { ch, motion, expression, time, sel, tab } = live.current;
      const img = (id: string) => session.assets.image(id);
      const rig = ch.rig && ch.rig.bones.length ? ch.rig : null;
      const frame = characterFrame(ch, motion?.id, expression?.id, time);
      const box = rig ? { width: rig.width, height: rig.height } : natural(session.project, frame.kind === 'frame' ? frame.assetId : (ch.portraits.find((p) => p.id === (frame.kind === 'portrait' ? frame.portraitId : null)) || ch.portraits[0])?.assetId || null) || { width: 400, height: 600 };
      const k = Math.min((w - 40) / box.width, (h - 40) / box.height);
      const ox = (w - box.width * k) / 2, oy = (h - box.height * k) / 2;
      view.current = { k, ox, oy };
      ctx.save();
      ctx.translate(ox, oy); ctx.scale(k, k);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1 / k; ctx.setLineDash([4 / k, 4 / k]);
      ctx.strokeRect(0, 0, box.width, box.height); ctx.setLineDash([]);
      if (rig && (tab === 'rig' || frame.kind === 'rig' || !motion || motion.kind === 'rig')) {
        // The Skeleton tab edits the rest pose; the other tabs show the motion / expression.
        const pose: Pose = tab === 'rig' || tab === 'import' ? rigPose(rig) : frame.kind === 'rig' ? frame.pose : rigPose(rig, motion, time, expression);
        drawRig(ctx, rig, pose, img, { outline: '#8c9bff', selected: sel?.kind === 'part' ? sel.id : null });
        if (tab !== 'import') drawBones(ctx, rig, pose, sel, k);
      } else {
        const id = frame.kind === 'frame' ? frame.assetId : (ch.portraits.find((p) => p.id === (frame.kind === 'portrait' ? frame.portraitId : null)) || ch.portraits[0])?.assetId;
        const im = id ? img(id) : null;
        if (im) ctx.drawImage(im, 0, 0, box.width, box.height);
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const drag = useRef<{ x: number; y: number; key: string; rotate: boolean; moved: boolean } | null>(null);
  const toRig = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const { k, ox, oy } = view.current;
    return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
  };
  const poseNow = () => {
    const { ch, motion, expression, time } = live.current;
    if (live.current.tab === 'rig') return rigPose(ch.rig!);
    const f = characterFrame(ch, motion?.id, expression?.id, time);
    return f.kind === 'rig' ? f.pose : rigPose(ch.rig!, null, 0, expression);
  };

  const down = (e: React.PointerEvent) => {
    const rig = live.current.ch.rig;
    if (!rig || !rig.bones.length || tab === 'import') return;
    const p = toRig(e);
    const pose = poseNow();
    const worlds = boneWorlds(rig, pose);
    // Bone joints first (they are small), then parts.
    let hit: Sel = null;
    let best = 12 / view.current.k;
    for (const b of rig.bones) { const m = worlds.get(b.id)!; const d = Math.hypot(m[4] - p.x, m[5] - p.y); if (d < best) { best = d; hit = { kind: 'bone', id: b.id }; } }
    if (!hit) { const part = hitRigPart(rig, pose, p.x, p.y); if (part) hit = { kind: 'part', id: part }; }
    if (!hit) { onSelect(null); return; }
    onSelect(hit);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: p.x, y: p.y, key: `studio-drag-${Date.now()}`, rotate: e.shiftKey, moved: false };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const { ch, motion, time, tab } = live.current;
    const s = live.current.sel;
    if (!d || !s || !ch.rig) return;
    const p = toRig(e);
    const dx = p.x - d.x, dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 2 / view.current.k) return;
    d.moved = true;
    const rig = ch.rig;
    const pose = poseNow();
    const worlds = boneWorlds(rig, pose);
    // The space the selected item moves in: its parent bone (bones) or its bone (parts).
    const boneOf = s.kind === 'bone' ? rig.bones.find((b) => b.id === s.id)?.parent || '' : rig.parts.find((x) => x.id === s.id)?.bone || '';
    const parent: RigMat = worlds.get(boneOf) || worlds.get('')!;
    const inv = rigInvert(parent);
    let lx = inv[0] * dx + inv[2] * dy, ly = inv[1] * dx + inv[3] * dy;
    let rot = 0;
    if (d.rotate) {
      const pivot = s.kind === 'bone' ? worlds.get(s.id)! : parent;
      const a0 = Math.atan2(d.y - pivot[5], d.x - pivot[4]), a1 = Math.atan2(p.y - pivot[5], p.x - pivot[4]);
      rot = ((a1 - a0) * 180) / Math.PI;
      lx = 0; ly = 0;
    }
    d.x = p.x; d.y = p.y;
    const label = t(d.rotate ? 'studio.rotateHistory' : 'studio.moveHistory');
    onEdit(label, (c) => {
      const r = c.rig!;
      if (tab === 'rig') {
        if (s.kind === 'bone') { const b = r.bones.find((x) => x.id === s.id); if (b) { b.x += lx; b.y += ly; b.rotation += rot; } }
        else { const part = r.parts.find((x) => x.id === s.id); const a = part?.attachments.find((x) => x.name === part.attachment); if (a) { a.x += lx; a.y += ly; a.rotation += rot; } }
      } else if (tab === 'motions' && motion?.kind === 'rig' && s.kind === 'bone') {
        const m = c.motions!.find((x) => x.id === motion.id)!;
        const cur = (prop: BoneProp) => { const tr = m.tracks?.find((x) => x.target === 'bone' && x.id === s.id && x.prop === prop); return tr ? Number(sampleRigTrack(tr, time)) : neutral(prop); };
        if (rot) upsertKey(m, 'bone', s.id, 'rotation', time, Math.round((cur('rotation') + rot) * 100) / 100);
        else { upsertKey(m, 'bone', s.id, 'x', time, Math.round((cur('x') + lx) * 10) / 10); upsertKey(m, 'bone', s.id, 'y', time, Math.round((cur('y') + ly) * 10) / 10); }
      } else if (tab === 'expressions' && s.kind === 'bone') {
        const ex = c.expressions?.find((x) => x.id === live.current.expression?.id);
        if (!ex) return;
        ex.bones ||= {};
        const o = (ex.bones[s.id] ||= {});
        o.x = Math.round(((o.x || 0) + lx) * 10) / 10; o.y = Math.round(((o.y || 0) + ly) * 10) / 10; o.rotation = Math.round(((o.rotation || 0) + rot) * 100) / 100;
      }
    }, d.key);
  };

  return (
    <canvas ref={ref} className={cx('studio-canvas', !ch.rig && 'no-rig')} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      aria-label={t('studio.preview')} />
  );
}

function drawBones(ctx: CanvasRenderingContext2D, rig: CharacterRig, pose: Pose, sel: Sel, k: number) {
  const worlds = boneWorlds(rig, pose);
  for (const b of rig.bones) {
    const m = worlds.get(b.id)!;
    const on = sel?.kind === 'bone' && sel.id === b.id;
    const len = b.length || 0;
    const ex = m[4] + m[0] * len, ey = m[5] + m[1] * len;
    ctx.strokeStyle = on ? '#ffd166' : 'rgba(255,209,102,.55)';
    ctx.lineWidth = (on ? 3 : 2) / k;
    if (len) { ctx.beginPath(); ctx.moveTo(m[4], m[5]); ctx.lineTo(ex, ey); ctx.stroke(); }
    ctx.fillStyle = on ? '#ffd166' : 'rgba(20,20,30,.85)';
    ctx.beginPath(); ctx.arc(m[4], m[5], (on ? 6 : 5) / k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // Origin (where the element stands).
  const o = rig.origin;
  ctx.strokeStyle = 'rgba(120,220,255,.8)'; ctx.lineWidth = 1.5 / k;
  ctx.beginPath(); ctx.moveTo(o.x - 10 / k, o.y); ctx.lineTo(o.x + 10 / k, o.y); ctx.moveTo(o.x, o.y - 10 / k); ctx.lineTo(o.x, o.y + 10 / k); ctx.stroke();
}

/* ------------------------------------------------------------------ rig panel */

function boneTree(rig: CharacterRig): { bone: RigBone; depth: number }[] {
  const out: { bone: RigBone; depth: number }[] = [];
  const ids = new Set(rig.bones.map((b) => b.id));
  const walk = (parent: string | null, depth: number) => {
    for (const b of rig.bones.filter((x) => (parent === null ? !x.parent || !ids.has(x.parent) : x.parent === parent))) { out.push({ bone: b, depth }); if (depth < 32) walk(b.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

function imageMenu(session: ProjectSession, ev: React.MouseEvent, title: string, pick: (a: Asset) => void) {
  const t = session.i18n.t;
  const imgs = session.project.assets.filter((a) => a.kind === 'image');
  if (!imgs.length) { store.toast(t('assets.noneOfKind')); return; }
  openMenu(ev, imgs.map((a) => ({ label: a.name, icon: 'image', onClick: () => pick(a) })), { search: true, title });
}

function RigPanel({ session, ch, sel, setSel, upd, onGoImport }: { session: ProjectSession; ch: Character; sel: Sel; setSel: (s: Sel) => void; upd: Upd; onGoImport: () => void }) {
  const t = useT();
  const rig = ch.rig && ch.rig.bones.length ? ch.rig : null;
  const assetUrl = (id: string) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };
  if (!rig) {
    const portrait = ch.portraits.find((p) => p.assetId);
    return (
      <div className="studio-empty">
        <Icon name="bone" size={28} />
        <p>{t('studio.noRig')}</p>
        <div className="studio-empty-actions">
          <Button icon="user" disabled={!portrait} onClick={() => {
            const size = natural(session.project, portrait!.assetId) || { width: 600, height: 900 };
            upd(t('studio.newRigHistory'), (c) => {
              const r = emptyRig(size.width, size.height);
              const body = newBone('body', r.bones[0].id, 0, -size.height / 2);
              r.bones.push(body);
              r.parts.push({ id: newId('prt'), name: portrait!.name || 'body', bone: body.id, attachments: [{ name: portrait!.name || 'body', assetId: portrait!.assetId, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: size.width, height: size.height }], attachment: portrait!.name || 'body', opacity: 1 });
              c.rig = r;
            });
          }}>{t('studio.fromPortrait')}</Button>
          <Button icon="plus" onClick={() => upd(t('studio.newRigHistory'), (c) => { c.rig = emptyRig(600, 900); })}>{t('studio.emptyRig')}</Button>
          <Button icon="upload" kind="ghost" onClick={onGoImport}>{t('studio.importSpine')}</Button>
        </div>
      </div>
    );
  }
  const bone = sel?.kind === 'bone' ? rig.bones.find((b) => b.id === sel.id) : null;
  const part = sel?.kind === 'part' ? rig.parts.find((p) => p.id === sel.id) : null;
  const editBone = (fn: (b: RigBone) => void, mk?: string) => upd(t('studio.editBone'), (c) => { const b = c.rig!.bones.find((x) => x.id === bone!.id); if (b) fn(b); }, mk);
  const editPart = (fn: (p: RigPart) => void, mk?: string) => upd(t('studio.editPart'), (c) => { const p = c.rig!.parts.find((x) => x.id === part!.id); if (p) fn(p); }, mk);
  const att = part?.attachments.find((a) => a.name === part.attachment) || null;
  const editAtt = (fn: (a: RigAttachment) => void, mk?: string) => editPart((p) => { const a = p.attachments.find((x) => x.name === p.attachment); if (a) fn(a); }, mk);
  const addPart = (ev: React.MouseEvent) => imageMenu(session, ev, t('studio.addPart'), (a) => {
    const size = natural(session.project, a.id) || { width: 200, height: 200 };
    const id = newId('prt');
    const name = a.name.replace(/\.[^.]+$/, '');
    const boneId = bone?.id || part?.bone || rig.bones[0].id;
    upd(t('studio.addPart'), (c) => { c.rig!.parts.push({ id, name, bone: boneId, attachments: [{ name, assetId: a.id, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: size.width, height: size.height }], attachment: name, opacity: 1 }); });
    setSel({ kind: 'part', id });
  });
  const addBone = () => {
    const b = newBone(t('studio.boneN', { n: rig.bones.length + 1 }), bone?.id || rig.bones[0].id, 0, -60);
    upd(t('studio.addBone'), (c) => { c.rig!.bones.push(b); });
    setSel({ kind: 'bone', id: b.id });
  };
  const removeSel = () => {
    if (bone) {
      if (!bone.parent) { store.toast(t('studio.rootStays')); return; }
      upd(t('studio.deleteBone'), (c) => {
        const r = c.rig!;
        for (const b of r.bones) if (b.parent === bone.id) b.parent = bone.parent;
        for (const p of r.parts) if (p.bone === bone.id) p.bone = bone.parent;
        r.bones = r.bones.filter((b) => b.id !== bone.id);
        for (const m of c.motions || []) if (m.tracks) m.tracks = m.tracks.filter((tr) => !(tr.target === 'bone' && tr.id === bone.id));
        for (const e of c.expressions || []) if (e.bones) delete e.bones[bone.id];
      });
    } else if (part) {
      upd(t('studio.deletePart'), (c) => {
        c.rig!.parts = c.rig!.parts.filter((p) => p.id !== part.id);
        for (const m of c.motions || []) if (m.tracks) m.tracks = m.tracks.filter((tr) => !(tr.target === 'part' && tr.id === part.id));
        for (const e of c.expressions || []) if (e.parts) delete e.parts[part.id];
      });
    }
    setSel(null);
  };
  const movePart = (dir: 1 | -1) => upd(t('studio.reorder'), (c) => {
    const ps = c.rig!.parts; const i = ps.findIndex((p) => p.id === part!.id); const j = i + dir;
    if (i < 0 || j < 0 || j >= ps.length) return;
    [ps[i], ps[j]] = [ps[j], ps[i]];
  });
  const boneOptions = rig.bones.map((b) => ({ value: b.id, label: b.name }));
  return (
    <>
      <Section id="studio.size" title={t('studio.size')} tip={t('studio.sizeTip')} defaultOpen={false}>
        <div className="studio-grid">
          <Field label={t('studio.width')}><NumberInput value={rig.width} min={1} unit="px" onChange={(v, tr) => upd(t('studio.editRig'), (c) => { c.rig!.width = Math.max(1, v); }, tr ? 'rig-w' : undefined)} /></Field>
          <Field label={t('studio.height')}><NumberInput value={rig.height} min={1} unit="px" onChange={(v, tr) => upd(t('studio.editRig'), (c) => { c.rig!.height = Math.max(1, v); }, tr ? 'rig-h' : undefined)} /></Field>
          <Field label={t('studio.originX')}><NumberInput value={rig.origin.x} unit="px" onChange={(v, tr) => upd(t('studio.editRig'), (c) => { c.rig!.origin.x = v; }, tr ? 'rig-ox' : undefined)} /></Field>
          <Field label={t('studio.originY')}><NumberInput value={rig.origin.y} unit="px" onChange={(v, tr) => upd(t('studio.editRig'), (c) => { c.rig!.origin.y = v; }, tr ? 'rig-oy' : undefined)} /></Field>
        </div>
      </Section>
      <Section id="studio.bones" title={<>{t('studio.bones')} <span className="muted">{rig.bones.length}</span></>} actions={<IconButton icon="plus" size={14} title={t('studio.addBone')} onClick={addBone} />}>
        <div className="studio-list">
          {boneTree(rig).map(({ bone: b, depth }) => (
            <button key={b.id} type="button" className={cx('studio-row', sel?.kind === 'bone' && sel.id === b.id && 'on')} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setSel({ kind: 'bone', id: b.id })}>
              <Icon name="bone" size={12} /><span>{b.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section id="studio.parts" title={<>{t('studio.parts')} <span className="muted">{rig.parts.length}</span></>} tip={t('studio.partsTip')} actions={<IconButton icon="imagePlus" size={14} title={t('studio.addPart')} onClick={addPart} />}>
        {!rig.parts.length ? <p className="muted small">{t('studio.noParts')}</p> : (
          <div className="studio-list">
            {[...rig.parts].reverse().map((p) => (
              <button key={p.id} type="button" className={cx('studio-row', sel?.kind === 'part' && sel.id === p.id && 'on')} onClick={() => setSel({ kind: 'part', id: p.id })}>
                <Icon name="image" size={12} /><span>{p.name}</span>
                <span className="muted small">{rig.bones.find((b) => b.id === p.bone)?.name}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
      {bone && (
        <Section id="studio.selBone" title={<><Icon name="bone" size={13} /> {bone.name}</>} actions={<IconButton icon="trash" size={13} title={t('common.delete')} onClick={removeSel} />}>
          <Field label={t('common.name')}><TextInput value={bone.name} onChange={(v) => editBone((b) => { b.name = v; })} /></Field>
          {bone.parent && <Field label={t('studio.parentBone')}><Select value={bone.parent} options={boneOptions.filter((o) => o.value !== bone.id && !descends(rig, o.value, bone.id))} onChange={(v) => editBone((b) => { b.parent = v; })} /></Field>}
          <div className="studio-grid">
            <Field label="X"><NumberInput value={round(bone.x)} onChange={(v, tr) => editBone((b) => { b.x = v; }, tr ? `b-x-${bone.id}` : undefined)} /></Field>
            <Field label="Y"><NumberInput value={round(bone.y)} onChange={(v, tr) => editBone((b) => { b.y = v; }, tr ? `b-y-${bone.id}` : undefined)} /></Field>
            <Field label={t('prop.rotation')}><NumberInput value={round(bone.rotation)} unit="°" onChange={(v, tr) => editBone((b) => { b.rotation = v; }, tr ? `b-r-${bone.id}` : undefined)} /></Field>
            <Field label={t('studio.length')}><NumberInput value={round(bone.length)} min={0} onChange={(v, tr) => editBone((b) => { b.length = Math.max(0, v); }, tr ? `b-l-${bone.id}` : undefined)} /></Field>
            <Field label={t('studio.scaleX')}><NumberInput value={bone.scaleX} step={0.05} onChange={(v, tr) => editBone((b) => { b.scaleX = v; }, tr ? `b-sx-${bone.id}` : undefined)} /></Field>
            <Field label={t('studio.scaleY')}><NumberInput value={bone.scaleY} step={0.05} onChange={(v, tr) => editBone((b) => { b.scaleY = v; }, tr ? `b-sy-${bone.id}` : undefined)} /></Field>
          </div>
        </Section>
      )}
      {part && (
        <Section id="studio.selPart" title={<><Icon name="image" size={13} /> {part.name}</>} actions={<>
          <IconButton icon="arrowUp" size={13} title={t('studio.forward')} onClick={() => movePart(1)} />
          <IconButton icon="arrowDown" size={13} title={t('studio.backward')} onClick={() => movePart(-1)} />
          <IconButton icon="trash" size={13} title={t('common.delete')} onClick={removeSel} />
        </>}>
          <Field label={t('common.name')}><TextInput value={part.name} onChange={(v) => editPart((p) => { p.name = v; })} /></Field>
          <div className="studio-grid">
            <Field label={t('studio.bone')}><Select value={part.bone || ''} options={boneOptions} onChange={(v) => editPart((p) => { p.bone = v; })} /></Field>
            <Field label={t('prop.opacity')}><NumberInput value={part.opacity} min={0} max={1} step={0.05} onChange={(v, tr) => editPart((p) => { p.opacity = v; }, tr ? `p-o-${part.id}` : undefined)} /></Field>
          </div>
          <div className="row-label">{t('studio.images')}</div>
          <p className="muted small">{t('studio.imagesTip')}</p>
          {part.attachments.map((a, i) => (
            <div key={i} className={cx('studio-att', a.name === part.attachment && 'on')}>
              <input type="radio" checked={a.name === part.attachment} onChange={() => editPart((p) => { p.attachment = a.name; })} aria-label={t('studio.showImage')} title={t('studio.showImage')} />
              <TextInput value={a.name} className="narrow" onChange={(v) => editPart((p) => { const name = v || a.name; if (p.attachment === p.attachments[i].name) p.attachment = name; p.attachments[i].name = name; })} ariaLabel={t('common.name')} />
              {a.region ? <span className="muted small">{t('studio.atlasPiece')}</span>
                : <AssetPicker project={session.project} kind="image" value={a.assetId} assetUrl={assetUrl} t={t} onChange={(v) => editPart((p) => { const x = p.attachments[i]; x.assetId = v; const n = natural(session.project, v); if (n) { x.width = n.width; x.height = n.height; } })} />}
              <IconButton icon="close" size={12} title={t('common.remove')} disabled={part.attachments.length <= 1} onClick={() => editPart((p) => { p.attachments.splice(i, 1); if (!p.attachments.some((x) => x.name === p.attachment)) p.attachment = p.attachments[0]?.name ?? null; })} />
            </div>
          ))}
          <div className="row-inline">
            <Button small kind="ghost" icon="plus" onClick={(ev) => imageMenu(session, ev, t('studio.addImage'), (asset) => {
              const n = natural(session.project, asset.id) || { width: att?.width || 100, height: att?.height || 100 };
              const name = uniqueAtt(part, asset.name.replace(/\.[^.]+$/, ''));
              editPart((p) => { p.attachments.push({ name, assetId: asset.id, x: att?.x || 0, y: att?.y || 0, rotation: att?.rotation || 0, scaleX: att?.scaleX ?? 1, scaleY: att?.scaleY ?? 1, width: n.width, height: n.height }); });
            })}>{t('studio.addImage')}</Button>
            <Toggle value={part.attachment === null} onChange={(v) => editPart((p) => { p.attachment = v ? null : p.attachments[0]?.name ?? null; })} label={t('studio.hidden')} />
          </div>
          {att && (
            <div className="studio-grid">
              <Field label="X"><NumberInput value={round(att.x)} onChange={(v, tr) => editAtt((a) => { a.x = v; }, tr ? `a-x-${part.id}` : undefined)} /></Field>
              <Field label="Y"><NumberInput value={round(att.y)} onChange={(v, tr) => editAtt((a) => { a.y = v; }, tr ? `a-y-${part.id}` : undefined)} /></Field>
              <Field label={t('prop.rotation')}><NumberInput value={round(att.rotation)} unit="°" onChange={(v, tr) => editAtt((a) => { a.rotation = v; }, tr ? `a-r-${part.id}` : undefined)} /></Field>
              <Field label={t('studio.scale')}><NumberInput value={att.scaleX} step={0.05} onChange={(v, tr) => editAtt((a) => { a.scaleX = v; a.scaleY = v; }, tr ? `a-s-${part.id}` : undefined)} /></Field>
              <Field label={t('studio.width')}><NumberInput value={round(att.width)} min={1} onChange={(v, tr) => editAtt((a) => { a.width = Math.max(1, v); }, tr ? `a-w-${part.id}` : undefined)} /></Field>
              <Field label={t('studio.height')}><NumberInput value={round(att.height)} min={1} onChange={(v, tr) => editAtt((a) => { a.height = Math.max(1, v); }, tr ? `a-h-${part.id}` : undefined)} /></Field>
            </div>
          )}
        </Section>
      )}
      {!bone && !part && <p className="muted small">{t('studio.selectHint')}</p>}
    </>
  );
}

const round = (v: number) => Math.round((v || 0) * 100) / 100;
const descends = (rig: CharacterRig, id: string, of: string): boolean => { let p: string | null | undefined = id; for (let i = 0; p && i < 64; i++) { if (p === of) return true; p = rig.bones.find((b) => b.id === p)?.parent; } return false; };
const uniqueAtt = (p: RigPart, base: string) => { let n = 1; while (p.attachments.some((a) => a.name === (n === 1 ? base : `${base} ${n}`))) n++; return n === 1 ? base : `${base} ${n}`; };

/* ------------------------------------------------------------------ motions panel */

function MotionsPanel({ session, ch, motion, setMotionId, sel, setSel, time, setTime, upd }: {
  session: ProjectSession; ch: Character; motion: CharacterMotion | null; setMotionId: (id: string | null) => void; sel: Sel; setSel: (s: Sel) => void; time: number; setTime: (t: number) => void; upd: Upd;
}) {
  const t = useT();
  const rig = ch.rig && ch.rig.bones.length ? ch.rig : null;
  const motions = ch.motions || [];
  const assetUrl = (id: string) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };
  const add = (kind: 'rig' | 'frames') => {
    const m: CharacterMotion = kind === 'rig'
      ? { id: newId('mot'), name: t('studio.motionN', { n: motions.length + 1 }), kind, duration: 1, loop: !motions.length, tracks: [] }
      : { id: newId('mot'), name: t('studio.motionN', { n: motions.length + 1 }), kind, duration: 0, loop: true, frames: [], fps: 12 };
    upd(t('studio.addMotion'), (c) => { (c.motions ||= []).push(m); if (!c.defaultMotion && m.loop) c.defaultMotion = m.id; });
    setMotionId(m.id);
  };
  const editM = (fn: (m: CharacterMotion) => void, mk?: string) => upd(t('studio.editMotion'), (c) => { const m = c.motions?.find((x) => x.id === motion!.id); if (m) fn(m); }, mk);
  const target = sel && motion?.kind === 'rig' ? sel : null;
  const tracksOf = (kind: string, id: string) => (motion?.tracks || []).filter((tr) => tr.target === kind && tr.id === id);
  const valueAt = (prop: string) => { const tr = motion?.tracks?.find((x) => x.target === target!.kind && x.id === target!.id && x.prop === prop); return tr ? sampleRigTrack(tr, time) : prop === 'attachment' ? undefined : neutral(prop); };
  const hasKey = (prop: string) => !!motion?.tracks?.find((x) => x.target === target!.kind && x.id === target!.id && x.prop === prop)?.keys.some((k) => Math.abs(k.t - time) < 1e-3);
  const setVal = (prop: RigTrack['prop'], v: any, tr?: boolean) => editM((m) => upsertKey(m, target!.kind, target!.id, prop, time, v), tr ? `k-${prop}-${target!.id}-${time.toFixed(3)}` : undefined);
  const toggleKey = (prop: RigTrack['prop']) => editM((m) => { if (hasKey(prop)) removeKey(m, target!.kind, target!.id, prop, time); else upsertKey(m, target!.kind, target!.id, prop, time, valueAt(prop) ?? null); });
  const name = (kind: string, id: string) => kind === 'bone' ? rig?.bones.find((b) => b.id === id)?.name : rig?.parts.find((p) => p.id === id)?.name;
  const part = target?.kind === 'part' ? rig?.parts.find((p) => p.id === target.id) : null;
  const keyTimes = [...new Set((motion?.tracks || []).flatMap((tr) => tr.keys.map((k) => k.t)))].sort((a, b) => a - b);
  return (
    <>
      <Section id="studio.motions" title={<>{t('studio.tab.motions')} <span className="muted">{motions.length}</span></>} tip={t('studio.motionsTip')} actions={<>
        <IconButton icon="bone" size={14} title={t('studio.addRigMotion')} disabled={!rig} onClick={() => add('rig')} />
        <IconButton icon="images" size={14} title={t('studio.addFramesMotion')} onClick={() => add('frames')} />
      </>}>
        {!motions.length ? <p className="muted small">{rig ? t('studio.noMotions') : t('studio.noMotionsNoRig')}</p> : (
          <div className="studio-list">
            {motions.map((m) => (
              <button key={m.id} type="button" className={cx('studio-row', motion?.id === m.id && 'on')} onClick={() => setMotionId(m.id)}>
                <Icon name={m.kind === 'rig' ? 'bone' : 'images'} size={12} /><span>{m.name}</span>
                {ch.defaultMotion === m.id && <span className="lib-badge">{t('studio.idle')}</span>}
                <span className="muted small">{motionDuration(m).toFixed(2)}s{m.loop ? ' ⟳' : ''}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
      {motion && (
        <Section id="studio.motion" title={<><Icon name={motion.kind === 'rig' ? 'bone' : 'images'} size={13} /> {motion.name}</>} actions={<IconButton icon="trash" size={13} title={t('common.delete')} onClick={async () => {
          if (!(await store.confirm(t('studio.deleteMotionTitle'), t('studio.deleteMotionText', { name: motion.name }), t('common.delete'), true))) return;
          upd(t('studio.deleteMotion'), (c) => { c.motions = (c.motions || []).filter((m) => m.id !== motion.id); if (c.defaultMotion === motion.id) c.defaultMotion = null; });
          setMotionId(null);
        }} />}>
          <Field label={t('common.name')}><TextInput value={motion.name} onChange={(v) => editM((m) => { m.name = v; })} /></Field>
          <div className="studio-grid">
            {motion.kind === 'rig'
              ? <Field label={t('studio.duration')}><NumberInput value={motion.duration} min={0.05} step={0.05} unit="s" onChange={(v, tr) => editM((m) => { m.duration = Math.max(0.05, v); }, tr ? 'm-dur' : undefined)} /></Field>
              : <Field label={t('studio.fps')}><NumberInput value={motion.fps || 12} min={1} max={120} onChange={(v, tr) => editM((m) => { m.fps = Math.max(1, v); }, tr ? 'm-fps' : undefined)} /></Field>}
            <Field label=" "><Toggle value={motion.loop} onChange={(v) => editM((m) => { m.loop = v; })} label={t('studio.loop')} /></Field>
          </div>
          <Toggle value={ch.defaultMotion === motion.id} onChange={(v) => upd(t('studio.editMotion'), (c) => { c.defaultMotion = v ? motion.id : null; })} label={t('studio.isIdle')} />
          <p className="muted small">{t('studio.idleTip')}</p>
          {motion.kind === 'frames' && (
            <>
              <div className="row-label">{t('studio.frames', { n: motion.frames?.length || 0 })}</div>
              <div className="studio-frames">
                {(motion.frames || []).map((f, i) => {
                  const url = assetUrl(f);
                  return (
                    <div key={i} className="studio-frame">
                      {url ? <img src={url} alt="" /> : <Icon name="image" size={16} />}
                      <span className="mono small">{i + 1}</span>
                      <button type="button" className="studio-frame-x" title={t('common.remove')} onClick={() => editM((m) => { m.frames!.splice(i, 1); })}><Icon name="close" size={10} /></button>
                    </div>
                  );
                })}
              </div>
              <div className="row-inline">
                <Button small kind="ghost" icon="plus" onClick={(ev) => imageMenu(session, ev, t('studio.addFrame'), (a) => editM((m) => { (m.frames ||= []).push(a.id); }))}>{t('studio.addFrame')}</Button>
                <FilesButton accept="image/*" label={t('studio.importFrames')} onFiles={async (files) => {
                  const ids = await importFiles(session, sortByName(files));
                  if (ids.length) editM((m) => { (m.frames ||= []).push(...ids); });
                }} />
              </div>
            </>
          )}
          {motion.kind === 'rig' && !target && <p className="muted small">{t('studio.pickToKey')}</p>}
        </Section>
      )}
      {motion?.kind === 'rig' && target && rig && (
        <Section id="studio.keys" title={<><Icon name="keyframe" size={13} /> {name(target.kind, target.id)} <span className="muted">@ {time.toFixed(2)}s</span></>} tip={t('studio.keysTip')}>
          {target.kind === 'bone' ? (
            <div className="studio-keys">
              {BONE_PROPS.map((prop) => (
                <div key={prop} className="studio-key-row">
                  <span className="studio-key-label">{t(`studio.motionProp.${prop}`)}</span>
                  <NumberInput value={round(Number(valueAt(prop)))} step={prop.startsWith('scale') ? 0.05 : 1} onChange={(v, tr) => setVal(prop, v, tr)} />
                  <IconButton icon="keyframe" size={13} active={hasKey(prop)} title={t(hasKey(prop) ? 'studio.removeKey' : 'studio.addKey')} onClick={() => toggleKey(prop)} />
                </div>
              ))}
            </div>
          ) : part && (
            <div className="studio-keys">
              <div className="studio-key-row">
                <span className="studio-key-label">{t('studio.image')}</span>
                <Select value={String(valueAt('attachment') ?? part.attachment ?? '')} options={[{ value: '', label: t('studio.hidden') }, ...part.attachments.map((a) => ({ value: a.name, label: a.name }))]} onChange={(v) => setVal('attachment', v || null)} />
                <IconButton icon="keyframe" size={13} active={hasKey('attachment')} title={t(hasKey('attachment') ? 'studio.removeKey' : 'studio.addKey')} onClick={() => toggleKey('attachment')} />
              </div>
              <div className="studio-key-row">
                <span className="studio-key-label">{t('prop.opacity')}</span>
                <NumberInput value={round(Number(valueAt('opacity') ?? part.opacity))} min={0} max={1} step={0.05} onChange={(v, tr) => setVal('opacity', v, tr)} />
                <IconButton icon="keyframe" size={13} active={hasKey('opacity')} title={t(hasKey('opacity') ? 'studio.removeKey' : 'studio.addKey')} onClick={() => toggleKey('opacity')} />
              </div>
            </div>
          )}
          {tracksOf(target.kind, target.id).map((tr) => (
            <div key={tr.prop} className="studio-track">
              <span className="studio-key-label">{t(tr.prop === 'attachment' ? 'studio.image' : tr.prop === 'opacity' ? 'prop.opacity' : `studio.motionProp.${tr.prop}`)}</span>
              <div className="chip-wrap">
                {tr.keys.map((k) => (
                  <button key={k.t} type="button" className={cx('chip-btn', Math.abs(k.t - time) < 1e-3 && 'on')} title={t('studio.keyAt', { t: k.t.toFixed(2) })}
                    onClick={() => setTime(k.t)}
                    onContextMenu={(e) => { e.preventDefault(); openMenu(e, [
                      ...EASES.map((ez) => ({ label: `${t('studio.ease')}: ${t(EASE_LABEL[ez])}`, icon: (k.ease || 'linear') === ez ? 'check' : undefined, onClick: () => editM((m) => { const x = m.tracks!.find((q) => q.target === tr.target && q.id === tr.id && q.prop === tr.prop)!.keys.find((q) => q.t === k.t); if (x) x.ease = ez; }) })),
                      { label: t('studio.removeKey'), icon: 'trash', danger: true, onClick: () => editM((m) => removeKey(m, tr.target, tr.id, tr.prop, k.t)) },
                    ]); }}>
                    {k.t.toFixed(2)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="muted small">{t('studio.keyChipTip')}</p>
        </Section>
      )}
      {motion?.kind === 'rig' && keyTimes.length > 0 && (
        <Section id="studio.keyTimes" title={t('studio.allKeys')} defaultOpen={false}>
          <div className="chip-wrap">{keyTimes.map((k) => <button key={k} type="button" className={cx('chip-btn', Math.abs(k - time) < 1e-3 && 'on')} onClick={() => setTime(k)}>{k.toFixed(2)}</button>)}</div>
          <div className="studio-list">
            {(motion.tracks || []).map((tr, i) => (
              <button key={i} type="button" className="studio-row" onClick={() => setSel({ kind: tr.target, id: tr.id })}>
                <Icon name={tr.target === 'bone' ? 'bone' : 'image'} size={12} /><span>{name(tr.target, tr.id) || '?'}</span>
                <span className="muted small">{tr.prop} · {tr.keys.length}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ expressions panel */

function ExpressionsPanel({ session, ch, expression, setExprId, sel, upd }: { session: ProjectSession; ch: Character; expression: CharacterExpression | null; setExprId: (id: string | null) => void; sel: Sel; upd: Upd }) {
  const t = useT();
  const rig = ch.rig && ch.rig.bones.length ? ch.rig : null;
  const list = ch.expressions || [];
  const add = () => {
    const e: CharacterExpression = { id: newId('exp'), name: t('studio.expressionN', { n: list.length + 1 }), parts: {}, bones: {}, portraitId: null };
    upd(t('studio.addExpression'), (c) => { (c.expressions ||= []).push(e); });
    setExprId(e.id);
  };
  const editE = (fn: (e: CharacterExpression) => void, mk?: string) => upd(t('studio.editExpression'), (c) => { const e = c.expressions?.find((x) => x.id === expression!.id); if (e) fn(e); }, mk);
  const bone = sel?.kind === 'bone' && rig ? rig.bones.find((b) => b.id === sel.id) : null;
  return (
    <>
      <Section id="studio.expressions" title={<>{t('studio.tab.expressions')} <span className="muted">{list.length}</span></>} tip={t('studio.expressionsTip')} actions={<IconButton icon="plus" size={14} title={t('studio.addExpression')} onClick={add} />}>
        {!list.length ? <p className="muted small">{t('studio.noExpressions')}</p> : (
          <div className="studio-list">
            {list.map((e) => (
              <button key={e.id} type="button" className={cx('studio-row', expression?.id === e.id && 'on')} onClick={() => setExprId(e.id)}>
                <Icon name="smile" size={12} /><span>{e.name}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
      {expression && (
        <Section id="studio.expression" title={<><Icon name="smile" size={13} /> {expression.name}</>} actions={<IconButton icon="trash" size={13} title={t('common.delete')} onClick={() => { upd(t('studio.deleteExpression'), (c) => { c.expressions = (c.expressions || []).filter((e) => e.id !== expression.id); }); setExprId(null); }} />}>
          <Field label={t('common.name')}><TextInput value={expression.name} onChange={(v) => editE((e) => { e.name = v; })} /></Field>
          <Field label={t('studio.exprPortrait')} hint={t('studio.exprPortraitTip')}>
            <Select value={expression.portraitId || ''} options={[{ value: '', label: t('prop.portrait.default') }, ...ch.portraits.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => editE((e) => { e.portraitId = v || null; })} />
          </Field>
          {rig && rig.parts.some((p) => p.attachments.length > 1 || true) && (
            <>
              <div className="row-label">{t('studio.exprParts')}</div>
              <div className="studio-keys expr">
                {[...rig.parts].reverse().map((p) => {
                  const o = expression.parts?.[p.id];
                  const val = o?.attachment === undefined ? '__same' : o.attachment === null ? '' : o.attachment;
                  return (
                    <div key={p.id} className="studio-key-row">
                      <span className="studio-key-label" title={p.name}>{p.name}</span>
                      <Select value={val} options={[{ value: '__same', label: t('studio.unchanged') }, { value: '', label: t('studio.hidden') }, ...p.attachments.map((a) => ({ value: a.name, label: a.name }))]}
                        onChange={(v) => editE((e) => { e.parts ||= {}; const cur = { ...(e.parts[p.id] || {}) }; if (v === '__same') delete cur.attachment; else cur.attachment = v || null; if (Object.keys(cur).length) e.parts[p.id] = cur; else delete e.parts[p.id]; })} />
                      <NumberInput value={o?.opacity ?? p.opacity} min={0} max={1} step={0.05} title={t('prop.opacity')} onChange={(v, tr) => editE((e) => { e.parts ||= {}; e.parts[p.id] = { ...(e.parts[p.id] || {}), opacity: v }; }, tr ? `e-o-${p.id}` : undefined)} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {rig && (bone ? (
            <>
              <div className="row-label">{t('studio.exprBone', { name: bone.name })}</div>
              <div className="studio-grid">
                {(['x', 'y', 'rotation'] as const).map((k) => (
                  <Field key={k} label={t(`studio.motionProp.${k}`)}><NumberInput value={round(expression.bones?.[bone.id]?.[k] || 0)} onChange={(v, tr) => editE((e) => { e.bones ||= {}; e.bones[bone.id] = { ...(e.bones[bone.id] || {}), [k]: v }; }, tr ? `e-${k}-${bone.id}` : undefined)} /></Field>
                ))}
                <Field label=" "><Button small kind="ghost" onClick={() => editE((e) => { if (e.bones) delete e.bones[bone.id]; })}>{t('studio.resetBone')}</Button></Field>
              </div>
            </>
          ) : <p className="muted small">{t('studio.exprPickBone')}</p>)}
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ import panel */

function FilesButton({ accept, label, onFiles, icon = 'upload', primary }: { accept: string; label: string; onFiles: (f: File[]) => void | Promise<void>; icon?: string; primary?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button small={!primary} kind={primary ? 'primary' : 'ghost'} icon={icon} disabled={busy} onClick={() => ref.current?.click()}>{label}</Button>
      <input ref={ref} type="file" multiple accept={accept} hidden onChange={async (e) => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        if (!files.length) return;
        setBusy(true);
        try { await onFiles(files); } catch (err: any) { store.toast(String(err?.message || err), 'error'); } finally { setBusy(false); }
      }} />
    </>
  );
}

const sortByName = (files: File[]) => [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/** Import files as project assets one by one (so each file maps to its asset). */
async function importFiles(session: ProjectSession, files: File[]): Promise<string[]> {
  const t = session.i18n.t;
  const ids: string[] = [];
  const added: Asset[] = [];
  for (const f of files) {
    const r = await call('assets.import', { path: session.path, files: [{ name: f.name, dataBase64: await fileToBase64(f) }], existing: [...session.project.assets, ...added] });
    if (r.errors?.length) { store.toast(r.errors.join('\n'), 'error'); continue; }
    const a = r.assets[0];
    if (a) { added.push(a); ids.push(a.id); } else if (r.reused[0]) ids.push(r.reused[0]);
  }
  if (added.length) session.update(t('assets.import', { n: added.length }), (d) => { d.assets.push(...added); });
  return ids;
}

function ImportPanel({ session, ch, upd, onDone }: { session: ProjectSession; ch: Character; upd: Upd; onDone: (n: { tab: StudioTab; motionId?: string }) => void }) {
  const t = useT();
  const [report, setReport] = useState<string[] | null>(null);
  const spine = async (files: File[]) => {
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (!json) throw new Error(t('studio.spineNoJson'));
    const atlas = files.find((f) => /\.atlas(\.txt)?$/i.test(f.name)) || files.find((f) => /\.txt$/i.test(f.name));
    let data: any;
    try { data = JSON.parse(await json.text()); } catch { throw new Error(t('studio.spineBadJson')); }
    if (!data?.bones) throw new Error(t('studio.spineBadJson'));
    const result = importSpine(data, atlas ? await atlas.text() : null, newId);
    const images = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    const base = (p: string) => p.split(/[\\/]/).pop()!.toLowerCase();
    const need = result.images.map((ref) => {
      const name = ref.slice(ref.indexOf(':') + 1);
      const file = images.find((f) => f.name.toLowerCase() === base(name)) || images.find((f) => f.name.toLowerCase().replace(/\.[^.]+$/, '') === base(name).replace(/\.[^.]+$/, ''));
      return { ref, file };
    });
    const missing = need.filter((n) => !n.file).map((n) => n.ref.slice(n.ref.indexOf(':') + 1));
    if (ch.rig?.bones.length && !(await store.confirm(t('studio.replaceRigTitle'), t('studio.replaceRigText', { name: ch.name }), t('studio.replaceRig'), true))) return;
    const files2 = [...new Set(need.filter((n) => n.file).map((n) => n.file!))];
    const ids = await importFiles(session, files2);
    const byFile = new Map(files2.map((f, i) => [f, ids[i]]));
    const map = new Map(need.map((n) => [n.ref, n.file ? byFile.get(n.file) || null : null]));
    for (const p of result.rig.parts) for (const a of p.attachments) a.assetId = a.assetId ? map.get(a.assetId) ?? null : null;
    const idle = result.motions.find((m) => /idle|待机/i.test(m.name)) || result.motions.find((m) => m.loop) || null;
    upd(t('studio.spineHistory'), (c) => {
      c.rig = result.rig;
      c.motions = [...(c.motions || []).filter((m) => m.kind === 'frames'), ...result.motions];
      c.defaultMotion = idle?.id || c.defaultMotion || null;
      // Expressions keyed by the old rig's parts no longer apply.
      for (const e of c.expressions || []) { e.parts = {}; e.bones = {}; }
    });
    const lines = [t('studio.spineDone', { bones: result.rig.bones.length, parts: result.rig.parts.length, motions: result.motions.length })];
    if (missing.length) lines.push(t('studio.spineMissing', { files: missing.slice(0, 6).join(', ') + (missing.length > 6 ? '…' : '') }));
    for (const w of result.warnings) lines.push(t(`studio.spineWarn.${w}`));
    setReport(lines);
    store.toast(lines[0], missing.length ? 'info' : 'success');
  };
  const frames = async (files: File[]) => {
    const sorted = sortByName(files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name)));
    if (!sorted.length) return;
    const ids = await importFiles(session, sorted);
    const prefix = commonPrefix(sorted.map((f) => f.name.replace(/\.[^.]+$/, ''))).replace(/[\s_\-.0-9]+$/, '') || t('studio.motionN', { n: (ch.motions || []).length + 1 });
    const m: CharacterMotion = { id: newId('mot'), name: prefix, kind: 'frames', duration: 0, loop: true, frames: ids, fps: 12 };
    upd(t('studio.addMotion'), (c) => { (c.motions ||= []).push(m); if (!c.defaultMotion) c.defaultMotion = m.id; });
    onDone({ tab: 'motions', motionId: m.id });
  };
  return (
    <>
      <Section id="studio.import.spine" title={t('studio.importSpine')} tip={t('studio.spineTip')}>
        <p className="muted small">{t('studio.spineHelp')}</p>
        <FilesButton primary accept=".json,.atlas,.txt,.png,.jpg,.jpeg,.webp" label={t('studio.chooseSpine')} onFiles={spine} />
        {report && <ul className="studio-report">{report.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        {report && <div className="row-inline"><Button small onClick={() => onDone({ tab: 'motions' })}>{t('studio.goMotions')}</Button></div>}
      </Section>
      <Section id="studio.import.frames" title={t('studio.importFramesTitle')} tip={t('studio.framesTip')}>
        <p className="muted small">{t('studio.framesHelp')}</p>
        <FilesButton accept="image/*" label={t('studio.importFrames')} onFiles={frames} icon="images" />
      </Section>
      <Section id="studio.import.parts" title={t('studio.buildTitle')}>
        <p className="muted small">{t('studio.buildHelp')}</p>
        <FilesButton accept="image/*" label={t('studio.buildFromImages')} icon="imagePlus" onFiles={async (files) => {
          const sorted = sortByName(files);
          const ids = await importFiles(session, sorted);
          const sizes = ids.map((id) => natural(session.project, id) || { width: 200, height: 200 });
          upd(t('studio.newRigHistory'), (c) => {
            const W = Math.max(...sizes.map((s) => s.width), c.rig?.width || 0), H = Math.max(...sizes.map((s) => s.height), c.rig?.height || 0);
            const r = c.rig?.bones.length ? c.rig : emptyRig(W, H);
            const root = r.bones[0];
            ids.forEach((id, i) => {
              const name = sorted[i].name.replace(/\.[^.]+$/, '');
              // Layered exports (all images the same size): stack them on the box.
              r.parts.push({ id: newId('prt'), name, bone: root.id, attachments: [{ name, assetId: id, x: W / 2 - r.origin.x, y: H / 2 - r.origin.y, rotation: 0, scaleX: 1, scaleY: 1, width: sizes[i].width, height: sizes[i].height }], attachment: name, opacity: 1 });
            });
            c.rig = r;
          });
          onDone({ tab: 'rig' });
        }} />
      </Section>
    </>
  );
}

function commonPrefix(names: string[]): string {
  if (!names.length) return '';
  let p = names[0];
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  return p;
}

