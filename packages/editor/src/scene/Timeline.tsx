/**
 * The scene timeline, modelled on After Effects:
 * - one row per element with a layer bar (in / out points), expandable into property groups
 *   (Transform, Text, Style…) whose rows have a stopwatch, a value you can drag, a keyframe
 *   navigator (◀ ◆ ▶) and their keyframes;
 * - a graph editor (value curves with draggable keys and bezier handles);
 * - box selection, copy / paste, Alt-drag to stretch keys in time, snapping to the playhead,
 *   keys, markers and in/out points, markers, a work area and AE-style shortcuts;
 * - parent & link per element.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationClip, Keyframe, SceneData, Track, Layer, PropDef } from '@vne/core';
import { newId, createAnimation, DIALOGUE_LAYER } from '@vne/core';
import { effectMenuItems, saveEffectAsPreset, loadEffectPresets } from '../effects/userPresets';
import { normalizeTrack, clipEnd, sampleTrack, propKind, cubicBezier } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { usePrefs, getPrefs } from '../state/prefs';
import { sceneOf, updateScene, layerTree, clipOf, setLayerProps, setParent } from './sceneOps';
import { IconButton, NumberInput, Select, Toggle, Button, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu, MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';

const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'bounce', 'elastic', 'step', 'bezier'];
/** Bezier curves close to the built-in eases, used when a curve handle is first dragged. */
const EASE_BEZ: Record<string, [number, number, number, number]> = {
  linear: [0.33, 0.33, 0.67, 0.67], easeIn: [0.32, 0, 0.67, 0], easeOut: [0.33, 1, 0.68, 1], easeInOut: [0.65, 0, 0.35, 1], backOut: [0.34, 1.56, 0.64, 1],
};
const LEFT = 280;
const ROW = 26;
const GRAPH_COLORS = ['#ff6b6b', '#4ecdc4', '#ffd166', '#7d8bff', '#f78fb3', '#9be564', '#ff9f43', '#c39bff'];

type Key = `${string}:${string}`;
const kid = (tr: Track, k: Keyframe): Key => `${tr.id}:${k.id}`;

export function fmtTime(t: number, mode = getPrefs().timeDisplay, fps = getPrefs().fps): string {
  t = Math.max(0, t);
  if (mode === 'frames') {
    const total = Math.round(t * fps);
    const f = total % fps, s = Math.floor(total / fps) % 60, m = Math.floor(total / fps / 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

interface PropRowInfo { key: string; label: string; def?: PropDef; group: string }

export function Timeline({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const prefs = usePrefs();
  const scene = sceneOf(session, nodeId)!;
  const ui = session.sceneUI(nodeId);
  const clip = clipOf(scene, ui.clipId) || null;
  const [pps, setPps] = useState(() => Number(localStorage.getItem('vne.timeline.pps')) || 120);
  const [curve, setCurve] = useState<{ track: string; key: string } | null>(null);
  const [layerOpen, setLayerOpen] = useState<Map<string, boolean>>(new Map());
  const [groupOpen, setGroupOpen] = useState<Map<string, boolean>>(new Map());
  const [onlyAnimated, setOnlyAnimated] = useState(() => localStorage.getItem('vne.timeline.onlyAnimated') === '1');
  const [graph, setGraph] = useState(() => localStorage.getItem('vne.timeline.graph') === '1');
  const [graphProps, setGraphProps] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [scroll, setScroll] = useState({ left: 0, top: 0, w: 800, h: 300 });
  const rootRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const fps = Math.max(1, prefs.fps || 30);

  // Pick the first clip automatically.
  useEffect(() => { if (!clip && scene.animations[0]) session.setSceneUI(nodeId, { clipId: scene.animations[0].id }); }, [clip, scene.animations.length]);
  useEffect(() => { localStorage.setItem('vne.timeline.pps', String(pps)); }, [pps]);
  useEffect(() => { localStorage.setItem('vne.timeline.graph', graph ? '1' : ''); }, [graph]);
  useEffect(() => { localStorage.setItem('vne.timeline.onlyAnimated', onlyAnimated ? '1' : ''); }, [onlyAnimated]);

  // Scroll position and size of the lane area (the graph editor stays in view while rows scroll).
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const read = () => setScroll({ left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight });
    read();
    el.addEventListener('scroll', read);
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
  }, [!!clip]);

  // Wheel: scroll as usual; Ctrl/⌘/Alt + wheel (or a trackpad pinch) zooms time around the cursor.
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      const r = el.getBoundingClientRect();
      if (e.clientX - r.left < LEFT) return;
      e.preventDefault();
      const old = ppsRef.current;
      const next = Math.max(20, Math.min(600, old * Math.exp(-e.deltaY * 0.004)));
      const tAt = (e.clientX - r.left + el.scrollLeft - LEFT) / old;
      setPps(next);
      requestAnimationFrame(() => { el.scrollLeft = Math.max(0, tAt * next + LEFT - (e.clientX - r.left)); });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [!!clip]);

  // Editor playback: plays the clip (or loops the work area), audio clips in sync.
  useEffect(() => {
    if (!ui.playing || !clip) return;
    let raf = 0;
    let last = performance.now();
    const wa = clip.workArea;
    const end = wa ? wa.end : Math.max(0.1, clipEnd(clip));
    const start = wa ? wa.start : 0;
    if (wa && (ui.time < start || ui.time >= end)) session.setSceneUI(nodeId, { time: start });
    const step = (now: number) => {
      const s = session.sceneUI(nodeId);
      let time = s.time + (now - last) / 1000;
      last = now;
      if (time >= end) {
        if (clip.loop || wa) { time = start + ((time - start) % Math.max(0.01, end - start)); stopAudio(); }
        else { session.setSceneUI(nodeId, { time: end, playing: false }); stopAudio(); return; }
      }
      syncAudio(time);
      session.setSceneUI(nodeId, { time });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); stopAudio(); };
  }, [ui.playing, clip?.id, clip?.workArea?.start, clip?.workArea?.end]);

  const stopAudio = () => { for (const a of audioRef.current.values()) { a.pause(); } audioRef.current.clear(); };
  const syncAudio = (time: number) => {
    if (!clip) return;
    for (const m of clip.media) {
      const layer = scene.layers.find((l) => l.id === m.layerId);
      if (!layer || layer.type !== 'core.audio') continue;
      const url = session.assets.url(layer.props.assetId);
      if (!url) continue;
      const local = time - m.start + m.trimIn;
      const inRange = time >= m.start && (m.duration == null || time < m.start + m.duration);
      let el = audioRef.current.get(m.id);
      if (inRange && !el) {
        el = new Audio(url);
        el.volume = Math.max(0, Math.min(1, Number(layer.props.volume ?? 1)));
        el.currentTime = Math.max(0, local);
        el.play().catch(() => {});
        audioRef.current.set(m.id, el);
      } else if (!inRange && el) { el.pause(); audioRef.current.delete(m.id); }
    }
  };

  const quant = (time: number) => Math.round(time * fps) / fps;
  const setTime = (time: number) => session.setSceneUI(nodeId, { time: Math.max(0, Math.round(time * 1000) / 1000) });
  const upd = (label: string, fn: (c: AnimationClip, s: SceneData) => void, mk?: string) => updateScene(session, nodeId, label, (s) => { const c = s.animations.find((a) => a.id === ui.clipId); if (c) fn(c, s); }, mk);
  const focusRoot = () => rootRef.current?.focus({ preventScroll: true });

  const addClip = () => {
    const c = createAnimation(t('anim.defaultName', { n: scene.animations.length + 1 }), 3);
    if (!scene.animations.length) c.autoplay = true;
    updateScene(session, nodeId, t('anim.add'), (s) => { s.animations.push(c); });
    session.setSceneUI(nodeId, { clipId: c.id, time: 0 });
  };

  const rowsLayers = useMemo(() => layerTree(scene).map((r) => r.layer).filter((l) => l.type !== DIALOGUE_LAYER), [scene.layers]);

  if (!clip) {
    return (
      <div className="timeline empty-tl compact">
        <Button icon="plus" onClick={addClip} title={t('timeline.emptyText')}>{t('anim.add')}</Button>
      </div>
    );
  }

  const end = Math.max(clip.duration, clipEnd(clip));
  const width = Math.max(600, (end + 1) * pps);
  const selLayers = new Set(ui.selectedLayers);
  const selectedKeys = new Set(ui.selectedKeys);
  const setSelectedKeys = (ids: Iterable<string>) => session.setSceneUI(nodeId, { selectedKeys: [...ids] });

  /* ---------------- properties of an element, grouped ---------------- */
  const fxParamsOf = (layer: Layer) => layer.effect?.kind === 'inline' ? layer.effect.graph.params : layer.effect?.kind === 'ref' ? (session.project.effectGraphs.find((g) => g.id === (layer.effect as any).graphId)?.params || []) : [];
  const propsOf = (layer: Layer): PropRowInfo[] => {
    const out: PropRowInfo[] = session.engine.layerProps(layer.type).filter((p) => p.animatable).map((p) => ({ key: p.key, label: t(p.label), def: p, group: p.group || 'other' }));
    for (const p of fxParamsOf(layer)) if (p.type === 'number' || p.type === 'color') out.push({ key: `fx.${p.id}`, label: p.name, group: 'effect' });
    // Tracks of properties the element type no longer lists (e.g. from a module) still show.
    for (const tr of clip.tracks) if (tr.layerId === layer.id && !out.some((o) => o.key === tr.prop)) out.push({ key: tr.prop, label: tr.prop, group: 'other' });
    return out;
  };
  const groupLabel = (g: string) => (g === 'effect' ? t('effects.title') : t(`group.${g}`) !== `group.${g}` ? t(`group.${g}`) : t('timeline.group.other'));
  const trackOf = (layerId: string, prop: string) => clip.tracks.find((tr) => tr.layerId === layerId && tr.prop === prop);
  const isLayerOpen = (l: Layer) => layerOpen.get(l.id) ?? (selLayers.has(l.id) || clip.tracks.some((tr) => tr.layerId === l.id && tr.keyframes.length));

  /* ---------------- snapping ---------------- */
  const snapTargets = (skip: Set<string> = new Set(), withPlayhead = true): number[] => {
    const out = [0, clip.duration];
    if (withPlayhead) out.push(ui.time);
    for (const m of clip.markers || []) out.push(m.t);
    if (clip.workArea) out.push(clip.workArea.start, clip.workArea.end);
    for (const sp of Object.values(clip.spans || {})) { out.push(sp.in); if (sp.out != null) out.push(sp.out); }
    for (const tr of clip.tracks) for (const k of tr.keyframes) if (!skip.has(kid(tr, k))) out.push(k.t);
    return out;
  };
  /** Snap a time: to nearby targets (playhead, keys, markers, in/out), otherwise to whole frames. Shift = fine. */
  const snap = (time: number, fine: boolean, targets: number[]) => {
    if (fine) return Math.max(0, Math.round(time * 1000) / 1000);
    let best = 7 / pps, hit: number | null = null;
    for (const x of targets) { const d = Math.abs(x - time); if (d < best) { best = d; hit = x; } }
    return Math.max(0, hit ?? quant(time));
  };

  const xToTime = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + laneRef.current!.scrollLeft - LEFT) / pps);
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    focusRoot();
    session.setSceneUI(nodeId, { playing: false });
    const targets = snapTargets(new Set(), false);
    setTime(snap(xToTime(e.clientX), e.shiftKey, targets));
    const move = (ev: PointerEvent) => setTime(snap(xToTime(ev.clientX), ev.shiftKey, targets));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------------- keyframes ---------------- */
  const dragKeys = (e: React.PointerEvent, track: Track, key: Keyframe) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    focusRoot();
    const id = kid(track, key);
    let sel = new Set(selectedKeys);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); }
    else if (!sel.has(id)) sel = new Set([id]);
    session.setSceneUI(nodeId, { selectedKeys: [...sel], selectedLayers: [track.layerId] });
    const t0 = xToTime(e.clientX);
    const starts = new Map<string, number>();
    for (const tr of clip.tracks) for (const k of tr.keyframes) if (sel.has(kid(tr, k))) starts.set(kid(tr, k), k.t);
    const anchor = Math.min(...starts.values());
    const grabbed = key.t;
    const targets = snapTargets(sel);
    const stretch = e.altKey && starts.size > 1 && Math.abs(grabbed - anchor) > 1e-6;
    const mk = `kdrag-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const raw = xToTime(ev.clientX) - t0;
      if (!moved && Math.abs(raw * pps) < 3) return;
      moved = true;
      // Snap the grabbed key; the others follow it (or stretch around the first one with Alt).
      const target = snap(grabbed + raw, ev.shiftKey, targets);
      const dt = target - grabbed;
      const factor = stretch ? Math.max(0, (target - anchor) / (grabbed - anchor)) : 1;
      upd(t(stretch ? 'timeline.stretchKeys' : 'timeline.moveKeys'), (c) => {
        for (const tr of c.tracks) {
          let touched = false;
          for (const k of tr.keyframes) {
            const s = starts.get(kid(tr, k));
            if (s === undefined) continue;
            k.t = Math.max(0, Math.round((stretch ? anchor + (s - anchor) * factor : s + dt) * 1000) / 1000);
            touched = true;
          }
          if (touched) tr.keyframes.sort((a, b) => a.t - b.t);
        }
      }, mk);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) upd(t('timeline.moveKeys'), (c) => { for (const tr of c.tracks) normalizeTrack(tr); }, mk);
      else setTime(key.t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const setEase = (ids: Set<string>, ease: string) => upd(t('timeline.setEase'), (c) => { for (const tr of c.tracks) for (const k of tr.keyframes) if (ids.has(kid(tr, k))) { k.ease = ease; if (ease === 'bezier' && !k.bez) k.bez = [0.25, 0.1, 0.25, 1]; } });

  const keyMenu = (e: React.MouseEvent, track: Track, key: Keyframe) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = selectedKeys.has(kid(track, key)) ? selectedKeys : new Set([kid(track, key)]);
    const items: MenuItem[] = [
      { header: true, label: t('timeline.interpolation') },
      ...session.engine.interpolators.list().filter((i) => EASES.includes(i.id) || (i.owner && i.owner !== 'core')).map((i) => ({ label: t(i.label), checked: key.ease === i.id, onClick: () => setEase(ids, i.id) })),
      { label: t('timeline.editCurve'), icon: 'curve', onClick: () => { setEase(ids, 'bezier'); setCurve({ track: track.id, key: key.id }); } },
      { label: `${t('timeline.easyEase')} (F9)`, icon: 'curve', onClick: () => setEase(ids, 'easeInOut') },
      { separator: true },
      { label: t('common.copy'), icon: 'copy', onClick: () => copyKeys(ids) },
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteKeys(ids) },
    ];
    openMenu(e, items);
  };

  const deleteKeys = (ids: Set<string>) => {
    upd(t('timeline.deleteKeys'), (c) => {
      for (const tr of c.tracks) tr.keyframes = tr.keyframes.filter((k) => !ids.has(kid(tr, k)));
      c.tracks = c.tracks.filter((tr) => tr.keyframes.length);
    });
    setSelectedKeys([]);
  };

  const copyKeys = (ids: Set<string>) => {
    const items: { layerId: string; prop: string; t: number; v: any; ease: string; bez?: any }[] = [];
    for (const tr of clip.tracks) for (const k of tr.keyframes) if (ids.has(kid(tr, k))) items.push({ layerId: tr.layerId, prop: tr.prop, t: k.t, v: k.v, ease: k.ease, bez: k.bez });
    if (!items.length) return;
    const t0 = Math.min(...items.map((i) => i.t));
    store.clipboard = { kind: 'keyframes', data: items.map((i) => ({ ...i, t: i.t - t0 })) };
    store.toast(t('timeline.copied', { n: items.length }));
  };

  const pasteKeys = () => {
    if (store.clipboard?.kind !== 'keyframes') return;
    const items = store.clipboard.data as { layerId: string; prop: string; t: number; v: any; ease: string; bez?: any }[];
    const targetLayer = ui.selectedLayers.length === 1 ? ui.selectedLayers[0] : null;
    const sameLayer = new Set(items.map((i) => i.layerId)).size === 1;
    const pasted: string[] = [];
    upd(t('timeline.pasteKeys'), (c) => {
      for (const it of items) {
        const layerId = targetLayer && sameLayer ? targetLayer : it.layerId;
        if (!scene.layers.some((l) => l.id === layerId)) continue;
        let tr = c.tracks.find((x) => x.layerId === layerId && x.prop === it.prop);
        if (!tr) { tr = { id: newId('trk'), layerId, prop: it.prop, keyframes: [] }; c.tracks.push(tr); }
        const time = Math.round((ui.time + it.t) * 1000) / 1000;
        tr.keyframes = tr.keyframes.filter((k) => Math.abs(k.t - time) > 1e-3);
        const k = { id: newId('key'), t: time, v: it.v, ease: it.ease, bez: it.bez };
        tr.keyframes.push(k);
        pasted.push(`${tr.id}:${k.id}`);
        normalizeTrack(tr);
        if (time > c.duration) c.duration = Math.ceil(time * 10) / 10;
      }
    });
    setSelectedKeys(pasted);
  };

  /** Stopwatch: start animating a property (a key at the playhead with the current value), or stop (remove its keys). */
  const toggleStopwatch = (layer: Layer, p: PropRowInfo) => {
    const tr = trackOf(layer.id, p.key);
    if (tr) { upd(t('timeline.stopAnimating'), (c) => { c.tracks = c.tracks.filter((x) => x.id !== tr.id); }); return; }
    const current = currentValue(layer, p.key);
    upd(t('timeline.startAnimating'), (c) => {
      c.tracks.push({ id: newId('trk'), layerId: layer.id, prop: p.key, keyframes: [{ id: newId('key'), t: ui.time, v: current, ease: prefs.defaultEase || 'easeInOut' }] });
      if (ui.time > c.duration) c.duration = Math.ceil(ui.time * 10) / 10;
    });
  };
  const currentValue = (layer: Layer, prop: string): any => {
    const tr = trackOf(layer.id, prop);
    if (tr && tr.keyframes.length) return sampleTrack(session.engine, tr, ui.time, propKind(session.engine.layerProps(layer.type).find((p) => p.key === prop), tr.keyframes[0]?.v));
    const def = session.engine.layerProps(layer.type).find((p) => p.key === prop);
    if (prop.startsWith('fx.')) { const fp = fxParamsOf(layer).find((x) => `fx.${x.id}` === prop); return layer.props[prop] ?? fp?.default ?? 0; }
    return layer.props[prop] ?? def?.default ?? 0;
  };
  const toggleKeyAtPlayhead = (layer: Layer, prop: string) => {
    const tr = trackOf(layer.id, prop);
    const atKey = tr?.keyframes.find((k) => Math.abs(k.t - ui.time) < 1e-3);
    const v = currentValue(layer, prop);
    upd(atKey ? t('timeline.removeKey') : t('timeline.addKey'), (c) => {
      let x = c.tracks.find((y) => y.layerId === layer.id && y.prop === prop);
      if (atKey && x) { x.keyframes = x.keyframes.filter((k) => k.id !== atKey.id); if (!x.keyframes.length) c.tracks = c.tracks.filter((y) => y !== x); return; }
      if (!x) { x = { id: newId('trk'), layerId: layer.id, prop, keyframes: [] }; c.tracks.push(x); }
      x.keyframes.push({ id: newId('key'), t: ui.time, v, ease: prefs.defaultEase || 'easeInOut' });
      normalizeTrack(x);
      if (ui.time > c.duration) c.duration = Math.ceil(ui.time * 10) / 10;
    });
  };
  const jumpKey = (times: number[], dir: 1 | -1) => {
    const all = [...new Set(times)].sort((a, b) => a - b);
    const next = dir > 0 ? all.find((x) => x > ui.time + 1e-3) : [...all].reverse().find((x) => x < ui.time - 1e-3);
    if (next !== undefined) setTime(next);
  };

  const addMedia = (layer: Layer) => upd(t('timeline.addMedia'), (c) => { if (!c.media.some((m) => m.layerId === layer.id)) c.media.push({ id: newId('med'), layerId: layer.id, start: ui.time, trimIn: 0, duration: null }); });

  const dragMedia = (e: React.PointerEvent, mid: string, mode: 'move' | 'in' | 'out', assetDur: number) => {
    e.preventDefault();
    e.stopPropagation();
    const m0 = clip.media.find((m) => m.id === mid)!;
    const t0 = xToTime(e.clientX);
    const mk = `media-${Date.now()}`;
    const targets = snapTargets();
    const move = (ev: PointerEvent) => {
      const raw = xToTime(ev.clientX) - t0;
      const edge = mode === 'out' ? m0.start + (m0.duration ?? Math.max(0.1, assetDur - m0.trimIn)) : m0.start;
      const dt = snap(edge + raw, ev.shiftKey, targets) - edge;
      upd(t('timeline.editMedia'), (c) => {
        const m = c.media.find((x) => x.id === mid)!;
        const fullDur = (m0.duration ?? Math.max(0.1, assetDur - m0.trimIn));
        if (mode === 'move') m.start = Math.max(0, m0.start + dt);
        else if (mode === 'in') { const d = Math.max(-m0.trimIn, Math.min(fullDur - 0.1, dt)); m.start = Math.max(0, m0.start + d); m.trimIn = m0.trimIn + d; m.duration = fullDur - d; }
        else m.duration = Math.max(0.1, fullDur + dt);
      }, mk);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------------- layer bars: in / out points ---------------- */
  const spanOf = (layerId: string) => clip.spans?.[layerId] || null;
  const setSpan = (layerId: string, span: { in: number; out: number | null } | null, mk?: string, label = t('timeline.trimLayer')) => upd(label, (c) => {
    const spans = { ...(c.spans || {}) };
    if (!span || (span.in <= 1e-6 && span.out == null)) delete spans[layerId];
    else spans[layerId] = { in: Math.max(0, Math.round(span.in * 1000) / 1000), out: span.out == null ? null : Math.round(span.out * 1000) / 1000 };
    c.spans = Object.keys(spans).length ? spans : undefined;
  }, mk);
  const dragBar = (e: React.PointerEvent, layer: Layer, mode: 'move' | 'in' | 'out') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusRoot();
    session.setSceneUI(nodeId, { selectedLayers: [layer.id] });
    const sp0 = spanOf(layer.id) || { in: 0, out: null };
    const out0 = sp0.out ?? end;
    const t0 = xToTime(e.clientX);
    const mk = `span-${Date.now()}`;
    const targets = snapTargets().filter((x) => Math.abs(x - sp0.in) > 1e-6 && Math.abs(x - out0) > 1e-6);
    let moved = false;
    // Moving a bar also moves the element's keys and media with it, like After Effects.
    const keys = clip.tracks.filter((tr) => tr.layerId === layer.id).flatMap((tr) => tr.keyframes.map((k) => [tr.id, k.id, k.t] as const));
    const media = clip.media.filter((m) => m.layerId === layer.id).map((m) => [m.id, m.start] as const);
    const move = (ev: PointerEvent) => {
      const raw = xToTime(ev.clientX) - t0;
      if (!moved && Math.abs(raw * pps) < 3) return;
      moved = true;
      if (mode === 'in') setSpan(layer.id, { in: Math.min(snap(sp0.in + raw, ev.shiftKey, targets), out0 - 1 / fps), out: sp0.out }, mk);
      else if (mode === 'out') { const o = Math.max(snap(out0 + raw, ev.shiftKey, targets), sp0.in + 1 / fps); setSpan(layer.id, { in: sp0.in, out: o }, mk); }
      else {
        const ni = snap(sp0.in + raw, ev.shiftKey, targets);
        const dt = Math.max(-sp0.in, ni - sp0.in);
        upd(t('timeline.moveLayer'), (c) => {
          const spans = { ...(c.spans || {}) };
          spans[layer.id] = { in: Math.round((sp0.in + dt) * 1000) / 1000, out: sp0.out == null ? (dt !== 0 ? Math.round((out0 + dt) * 1000) / 1000 : null) : Math.round((sp0.out + dt) * 1000) / 1000 };
          c.spans = spans;
          for (const [trId, kId, kt] of keys) { const k = c.tracks.find((x) => x.id === trId)?.keyframes.find((x) => x.id === kId); if (k) k.t = Math.max(0, Math.round((kt + dt) * 1000) / 1000); }
          for (const [mId, st] of media) { const m = c.media.find((x) => x.id === mId); if (m) m.start = Math.max(0, st + dt); }
          if ((spans[layer.id].out ?? 0) > c.duration) c.duration = Math.ceil((spans[layer.id].out as number) * 10) / 10;
        }, mk);
      }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const barMenu = (e: React.MouseEvent, layer: Layer) => {
    e.preventDefault();
    e.stopPropagation();
    const sp = spanOf(layer.id) || { in: 0, out: null };
    openMenu(e, [
      { label: t('timeline.inToPlayhead'), icon: 'toIn', hint: 'Alt+[', onClick: () => setSpan(layer.id, { in: Math.min(ui.time, (sp.out ?? end) - 1 / fps), out: sp.out }) },
      { label: t('timeline.outToPlayhead'), icon: 'toOut', hint: 'Alt+]', onClick: () => setSpan(layer.id, { in: sp.in, out: Math.max(ui.time, sp.in + 1 / fps) }) },
      { label: t('timeline.resetSpan'), icon: 'refresh', disabled: !spanOf(layer.id), onClick: () => setSpan(layer.id, null) },
    ]);
  };

  /* ---------------- markers & work area ---------------- */
  const addMarker = () => {
    if ((clip.markers || []).some((m) => Math.abs(m.t - ui.time) < 1e-3)) return;
    upd(t('timeline.addMarker'), (c) => { c.markers = [...(c.markers || []), { id: newId('mrk'), t: ui.time, label: '' }].sort((a, b) => a.t - b.t); });
  };
  const dragMarker = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const m0 = (clip.markers || []).find((m) => m.id === id)!;
    const t0 = xToTime(e.clientX);
    const targets = snapTargets().filter((x) => Math.abs(x - m0.t) > 1e-6);
    const mk = `mrk-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const raw = xToTime(ev.clientX) - t0;
      if (!moved && Math.abs(raw * pps) < 3) return;
      moved = true;
      const nt = snap(m0.t + raw, ev.shiftKey, targets);
      upd(t('timeline.moveMarker'), (c) => { const m = c.markers?.find((x) => x.id === id); if (m) m.t = nt; }, mk);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved) setTime(m0.t); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const renameMarker = async (id: string) => {
    const m = (clip.markers || []).find((x) => x.id === id);
    if (!m) return;
    const v = await store.prompt(t('timeline.markerName'), t('common.name'), m.label);
    if (v !== null) upd(t('timeline.renameMarker'), (c) => { const x = c.markers?.find((y) => y.id === id); if (x) x.label = v; });
  };
  const deleteMarker = (id: string) => upd(t('timeline.deleteMarker'), (c) => { c.markers = (c.markers || []).filter((m) => m.id !== id); });
  const setWorkArea = (wa: { start: number; end: number } | null, mk?: string) => upd(t('timeline.workArea'), (c) => { c.workArea = wa ? { start: Math.max(0, Math.min(wa.start, wa.end - 1 / fps)), end: Math.max(wa.end, wa.start + 1 / fps) } : null; }, mk);
  const dragWorkArea = (e: React.PointerEvent, mode: 'start' | 'end' | 'move') => {
    if (e.button !== 0 || !clip.workArea) return;
    e.preventDefault();
    e.stopPropagation();
    const w0 = { ...clip.workArea };
    const t0 = xToTime(e.clientX);
    const targets = snapTargets();
    const mk = `wa-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const raw = xToTime(ev.clientX) - t0;
      if (mode === 'start') setWorkArea({ start: snap(w0.start + raw, ev.shiftKey, targets), end: w0.end }, mk);
      else if (mode === 'end') setWorkArea({ start: w0.start, end: snap(w0.end + raw, ev.shiftKey, targets) }, mk);
      else { const s = Math.max(0, snap(w0.start + raw, ev.shiftKey, targets)); setWorkArea({ start: s, end: s + (w0.end - w0.start) }, mk); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------------- box selection & panning on the lanes ---------------- */
  const lanePointerDown = (e: React.PointerEvent) => {
    const tg = e.target as HTMLElement;
    if (!tg.classList.contains('tl-lane') && !tg.classList.contains('tl-lanes-bg')) return;
    focusRoot();
    const el = laneRef.current!;
    // Middle button or Alt-drag pans; a plain drag draws a selection box.
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, l0 = el.scrollLeft, t0 = el.scrollTop;
      document.body.classList.add('panning');
      const move = (ev: PointerEvent) => { el.scrollLeft = l0 - (ev.clientX - sx); el.scrollTop = t0 - (ev.clientY - sy); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('panning'); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = add ? new Set(selectedKeys) : new Set<string>();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const r = { x0: Math.min(x0, ev.clientX), y0: Math.min(y0, ev.clientY), x1: Math.max(x0, ev.clientX), y1: Math.max(y0, ev.clientY) };
      setMarquee(r);
      const sel = new Set(base);
      el.querySelectorAll<HTMLElement>('.tl-key[data-k]').forEach((k) => {
        const b = k.getBoundingClientRect();
        if (b.right >= r.x0 && b.left <= r.x1 && b.bottom >= r.y0 && b.top <= r.y1) sel.add(k.dataset.k!);
      });
      setSelectedKeys(sel);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (!moved && !add) setSelectedKeys([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------------- keyboard (After Effects-style) ---------------- */
  const selectedLayerKeyTimes = () => clip.tracks.filter((tr) => !selLayers.size || selLayers.has(tr.layerId)).flatMap((tr) => tr.keyframes.map((k) => k.t));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const frame = 1 / fps;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.code === 'Space') { handled(); session.setSceneUI(nodeId, { playing: !ui.playing }); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeys.size) { handled(); deleteKeys(selectedKeys); }
    else if (mod && k === 'c' && selectedKeys.size) { handled(); copyKeys(selectedKeys); }
    else if (mod && k === 'v') { handled(); pasteKeys(); }
    else if (mod && k === 'a') { handled(); setSelectedKeys(clip.tracks.filter((tr) => !selLayers.size || selLayers.has(tr.layerId)).flatMap((tr) => tr.keyframes.map((x) => kid(tr, x)))); }
    else if (e.key === 'Home') { handled(); setTime(clip.workArea && !e.shiftKey ? clip.workArea.start : 0); }
    else if (e.key === 'End') { handled(); setTime(clip.workArea && !e.shiftKey ? clip.workArea.end : end); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { handled(); setTime(quant(ui.time) + (e.key === 'ArrowRight' ? 1 : -1) * frame * (e.shiftKey ? 10 : 1)); }
    else if (k === 'j' || e.key === ',') { handled(); jumpKey(selectedLayerKeyTimes(), -1); }
    else if (k === 'k' || e.key === '.') { handled(); jumpKey(selectedLayerKeyTimes(), 1); }
    else if (e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      handled();
      for (const id of selLayers) {
        const sp = spanOf(id) || { in: 0, out: null };
        if (e.code === 'BracketLeft') setSpan(id, { in: Math.min(ui.time, (sp.out ?? end) - frame), out: sp.out });
        else setSpan(id, { in: sp.in, out: Math.max(ui.time, sp.in + frame) });
      }
    }
    else if (k === 'i' && !mod) { const id = [...selLayers][0]; if (id) { handled(); setTime(spanOf(id)?.in ?? 0); } }
    else if (k === 'o' && !mod) { const id = [...selLayers][0]; if (id) { handled(); setTime(spanOf(id)?.out ?? end); } }
    else if (k === 'b' && !mod) { handled(); setWorkArea({ start: ui.time, end: clip.workArea?.end ?? Math.max(ui.time + 1, end) }); }
    else if (k === 'n' && !mod) { handled(); setWorkArea({ start: clip.workArea?.start ?? 0, end: Math.max(ui.time, (clip.workArea?.start ?? 0) + frame) }); }
    else if (k === 'm' && !mod) { handled(); addMarker(); }
    else if (k === 'u' && !mod) { handled(); setOnlyAnimated(!onlyAnimated); }
    else if ((k === 'g' && !mod) || (e.key === 'F3' && e.shiftKey)) { handled(); setGraph(!graph); }
    else if (e.key === 'F9' && selectedKeys.size) { handled(); setEase(selectedKeys, 'easeInOut'); }
  };

  /* ---------------- ruler ---------------- */
  const ticks: number[] = [];
  const stepT = pps > 360 ? 1 / fps * Math.max(1, Math.round(fps / 10)) : pps > 200 ? 0.1 : pps > 80 ? 0.5 : pps > 30 ? 1 : 5;
  for (let x = 0; x <= end + 1; x += stepT) ticks.push(Math.round(x * 1000) / 1000);
  const major = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
  const curveKey = curve ? clip.tracks.find((tr) => tr.id === curve.track)?.keyframes.find((k) => k.id === curve.key) : null;
  const parentName = (l: Layer) => (l.link ? scene.layers.find((x) => x.id === l.link)?.name : null);

  /* ---------------- rows ---------------- */
  const rows: JSX.Element[] = [];
  const graphTracks: { track: Track; label: string; color: string; layer: Layer; def?: PropDef }[] = [];

  for (const layer of rowsLayers) {
    const def = session.engine.layerTypes.get(layer.type);
    const visual = def?.visual !== false;
    const tracks = clip.tracks.filter((tr) => tr.layerId === layer.id);
    const media = clip.media.filter((m) => m.layerId === layer.id);
    const isMedia = layer.type === 'core.audio' || layer.type === 'core.video';
    const open = isLayerOpen(layer);
    const assetDur = Number(session.project.assets.find((a) => a.id === layer.props.assetId)?.meta.duration || 5);
    const props = propsOf(layer);
    const sp = spanOf(layer.id);
    const barIn = sp?.in ?? 0, barOut = sp?.out ?? end;
    const allKeyTimes = [...new Set(tracks.flatMap((tr) => tr.keyframes.map((k) => k.t)))];
    rows.push(
      <div key={`L${layer.id}`} className={cx('tl-row layer-head', selLayers.has(layer.id) && 'active')}>
        <div className="tl-left" onClick={(e) => session.setSceneUI(nodeId, { selectedLayers: e.shiftKey || e.metaKey || e.ctrlKey ? [...new Set([...ui.selectedLayers, layer.id])] : [layer.id] })}>
          <button type="button" className="twisty" onClick={(e) => { e.stopPropagation(); setLayerOpen(new Map(layerOpen).set(layer.id, !open)); }} aria-expanded={open}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></button>
          <Icon name={def?.icon || 'layers'} size={12} className="tl-layer-icon" />
          <span className="tl-layer-name" title={layer.name}>{layer.name}</span>
          {visual && (
            <button type="button" className={cx('tl-parent', layer.link && 'on')} title={layer.link ? `${t('insp.parent')}: ${parentName(layer)}` : t('insp.parentHint')}
              onClick={(e) => { e.stopPropagation(); openMenu(e, [
                { header: true, label: t('insp.parent') },
                { label: t('insp.noParent'), checked: !layer.link, onClick: () => setParent(session, nodeId, layer.id, null) },
                ...scene.layers.filter((x) => x.id !== layer.id && (x.parentId || null) === (layer.parentId || null) && session.engine.layerTypes.get(x.type)?.visual !== false && !followsLayer(scene, x.id, layer.id)).map((x) => ({ label: x.name, checked: layer.link === x.id, onClick: () => setParent(session, nodeId, layer.id, x.id) })),
              ]); }}>
              <Icon name="parent" size={11} />{layer.link && <span>{parentName(layer)}</span>}
            </button>
          )}
          <IconButton icon="plus" size={13} title={t('timeline.addProperty')} onClick={(e) => { e.stopPropagation(); openMenu(e, [
            ...props.filter((p) => !trackOf(layer.id, p.key)).map((p) => ({ label: p.label, icon: p.group === 'effect' ? 'sparkles' : 'stopwatch', onClick: () => toggleStopwatch(layer, p) })),
            ...(isMedia && !media.length ? [{ separator: true } as MenuItem, { label: t('timeline.addMedia'), icon: 'music', onClick: () => addMedia(layer) }] : []),
          ], { search: props.length > 10 }); }} />
          {visual && (
            <IconButton icon="sparkles" size={13} active={!!layer.effect} title={layer.effect ? t('fxp.effectMenu') : t('fxp.addMenu')} onClick={async (ev) => {
              ev.stopPropagation();
              const e = { clientX: ev.clientX, clientY: ev.clientY };
              await loadEffectPresets();
              const ids = selLayers.has(layer.id) && selLayers.size > 1 ? [...selLayers].filter((id) => session.engine.layerTypes.get(scene.layers.find((l) => l.id === id)?.type || '')?.visual) : [layer.id];
              openMenu(e, effectMenuItems(session, nodeId, ids, () => { if (ids.length === 1) session.setSceneUI(nodeId, { selectedLayers: [layer.id], effectsOpen: true }); }), { search: true });
            }} />
          )}
        </div>
        <div className="tl-lane summary" style={{ width }} onPointerDown={lanePointerDown}>
          {visual && (
            <div className={cx('tl-bar', selLayers.has(layer.id) && 'active', sp && 'trimmed')} style={{ left: barIn * pps, width: Math.max(6, (barOut - barIn) * pps) }}
              onPointerDown={(e) => dragBar(e, layer, 'move')} onDoubleClick={(e) => { e.stopPropagation(); if (sp) setSpan(layer.id, null); }} onContextMenu={(e) => barMenu(e, layer)}
              title={`${t('timeline.in')} ${fmtTime(barIn)} · ${t('timeline.out')} ${fmtTime(barOut)}`}>
              <span className="tl-bar-edge in" onPointerDown={(e) => dragBar(e, layer, 'in')} />
              <span className="tl-bar-edge out" onPointerDown={(e) => dragBar(e, layer, 'out')} />
            </div>
          )}
          {!open && allKeyTimes.map((x) => <span key={x} className="sum-key" style={{ left: x * pps }} />)}
        </div>
      </div>,
    );
    if (!open) continue;

    if (layer.effect) {
      rows.push(
        <div key={`F${layer.id}`} className="tl-row">
          <div className="tl-left prop fx-row">
            <Icon name="sparkles" size={12} />
            <button type="button" className="link" onClick={() => session.setSceneUI(nodeId, { selectedLayers: [layer.id], effectsOpen: true })}>
              {layer.effect.kind === 'inline' ? (layer.effect.graph.name || t('effects.title')) : (session.project.effectGraphs.find((g) => g.id === (layer.effect as any).graphId)?.name || t('effects.title'))}
            </button>
            <IconButton icon="bookmarkPlus" size={12} title={t('fxp.saveAsHint')} onClick={() => saveEffectAsPreset(session, layer)} />
            <IconButton icon="close" size={12} title={t('effects.remove')} onClick={() => updateScene(session, nodeId, t('effects.remove'), (sd) => { const l = sd.layers.find((x) => x.id === layer.id); if (l) l.effect = null; })} />
          </div>
          <div className="tl-lane" style={{ width }} onPointerDown={lanePointerDown} />
        </div>,
      );
    }
    for (const m of media) {
      const dur = m.duration ?? Math.max(0.1, assetDur - m.trimIn);
      rows.push(
        <div key={`M${m.id}`} className="tl-row">
          <div className="tl-left prop"><Icon name={layer.type === 'core.audio' ? 'music' : 'film'} size={12} /><span className="prop-name">{t('timeline.mediaClip')}</span>
            <IconButton icon="close" size={12} title={t('common.remove')} onClick={() => upd(t('timeline.removeMedia'), (c) => { c.media = c.media.filter((x) => x.id !== m.id); })} /></div>
          <div className="tl-lane" style={{ width }} onPointerDown={lanePointerDown}>
            <div className="media-bar" style={{ left: m.start * pps, width: Math.max(8, dur * pps) }} onPointerDown={(e) => dragMedia(e, m.id, 'move', assetDur)} title={`${t('timeline.start')}: ${m.start.toFixed(2)}s · ${t('timeline.trim')}: ${m.trimIn.toFixed(2)}s`}>
              <span className="media-edge in" onPointerDown={(e) => dragMedia(e, m.id, 'in', assetDur)} />
              <span className="media-label">{session.project.assets.find((a) => a.id === layer.props.assetId)?.name || layer.name}</span>
              <span className="media-edge out" onPointerDown={(e) => dragMedia(e, m.id, 'out', assetDur)} />
            </div>
          </div>
        </div>,
      );
    }

    const propRow = (p: PropRowInfo, depth: number) => {
      const tr = trackOf(layer.id, p.key);
      const val = currentValue(layer, p.key);
      const atKey = tr?.keyframes.find((k) => Math.abs(k.t - ui.time) < 1e-3);
      const gid = `${layer.id}|${p.key}`;
      const numeric = typeof val === 'number' || p.def?.type === 'number';
      if (tr && numeric) graphTracks.push({ track: tr, label: `${layer.name} · ${p.label}`, color: '', layer, def: p.def });
      const keyTimes = tr ? tr.keyframes.map((k) => k.t) : [];
      return (
        <div key={`P${layer.id}:${p.key}`} className={cx('tl-row prop-row', graph && graphProps.has(gid) && 'graph-on')}>
          <div className={cx('tl-left prop', `d${depth}`)}>
            <button type="button" className={cx('stopwatch', tr && 'on')} title={tr ? t('timeline.stopwatchOff') : t('timeline.stopwatchOn')} onClick={() => toggleStopwatch(layer, p)}><Icon name="stopwatch" size={12} /></button>
            <span className="prop-name" title={graph ? t('timeline.showInGraph') : t('timeline.selectPropKeys')}
              onClick={(e) => {
                if (graph) { const s = new Set(e.shiftKey || e.metaKey || e.ctrlKey ? graphProps : []); if (s.has(gid)) s.delete(gid); else s.add(gid); setGraphProps(s); return; }
                if (tr) setSelectedKeys(tr.keyframes.map((k) => kid(tr, k)));
                session.setSceneUI(nodeId, { selectedLayers: [layer.id] });
              }}>{p.label}</span>
            {numeric
              ? <ScrubValue value={Number(val) || 0} step={p.def?.step ?? (p.key.startsWith('scale') || p.key === 'opacity' ? 0.01 : 1)} min={p.def?.min} max={p.def?.max}
                  onChange={(v, transient) => setLayerProps(session, nodeId, layer.id, { [p.key]: v }, transient ? { mergeKey: `tl-${layer.id}-${p.key}` } : {})} />
              : <span className="prop-val" title={String(val ?? '')}>{typeof val === 'string' && /^#|rgb/.test(val) ? <span className="prop-swatch" style={{ background: val }} /> : String(val ?? '').slice(0, 10)}</span>}
            <span className="key-nav">
              <button type="button" disabled={!keyTimes.some((x) => x < ui.time - 1e-3)} onClick={() => jumpKey(keyTimes, -1)} title={t('timeline.prevKey')}><Icon name="chevronLeft" size={11} /></button>
              <button type="button" className={cx('key-dia', atKey ? 'key' : tr ? 'animated' : '')} onClick={() => toggleKeyAtPlayhead(layer, p.key)} title={atKey ? t('timeline.removeKey') : t('timeline.addKey')}><Icon name="keyframe" size={11} /></button>
              <button type="button" disabled={!keyTimes.some((x) => x > ui.time + 1e-3)} onClick={() => jumpKey(keyTimes, 1)} title={t('timeline.nextKey')}><Icon name="chevronRight" size={11} /></button>
            </span>
          </div>
          <div className="tl-lane" style={{ width }} onPointerDown={lanePointerDown} onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest('.tl-key')) return;
            const time = snap(xToTime(e.clientX), e.shiftKey, snapTargets());
            const v = tr ? sampleTrack(session.engine, tr, time, propKind(p.def, tr.keyframes[0]?.v)) : currentValue(layer, p.key);
            upd(t('timeline.addKey'), (c) => {
              let x = c.tracks.find((y) => y.layerId === layer.id && y.prop === p.key);
              if (!x) { x = { id: newId('trk'), layerId: layer.id, prop: p.key, keyframes: [] }; c.tracks.push(x); }
              x.keyframes.push({ id: newId('key'), t: time, v, ease: prefs.defaultEase || 'easeInOut' });
              normalizeTrack(x);
              if (time > c.duration) c.duration = Math.ceil(time * 10) / 10;
            });
            setTime(time);
          }}>
            {!graph && tr?.keyframes.map((k, i) => {
              const next = tr.keyframes[i + 1];
              return (
                <span key={k.id}>
                  {next && <span className={cx('key-span', k.ease === 'step' && 'step')} style={{ left: k.t * pps, width: (next.t - k.t) * pps }} />}
                  <span data-k={kid(tr, k)} className={cx('tl-key', `ease-${k.ease}`, selectedKeys.has(kid(tr, k)) && 'selected')} style={{ left: k.t * pps }}
                    onPointerDown={(e) => dragKeys(e, tr, k)} onContextMenu={(e) => keyMenu(e, tr, k)} onDoubleClick={(e) => { e.stopPropagation(); setCurve({ track: tr.id, key: k.id }); }}
                    title={`${fmtTime(k.t)} · ${typeof k.v === 'number' ? Math.round(k.v * 100) / 100 : k.v} · ${t(session.engine.interpolators.get(k.ease)?.label || k.ease)}`} />
                </span>
              );
            })}
          </div>
        </div>
      );
    };

    if (onlyAnimated) {
      for (const p of props) if (trackOf(layer.id, p.key)) rows.push(propRow(p, 1));
      continue;
    }
    const groups: string[] = [];
    for (const p of props) if (!groups.includes(p.group)) groups.push(p.group);
    for (const g of groups) {
      const gp = props.filter((p) => p.group === g);
      const gTracks = gp.map((p) => trackOf(layer.id, p.key)).filter(Boolean) as Track[];
      const gKey = `${layer.id}:${g}`;
      const gOpen = groupOpen.get(gKey) ?? (gTracks.length > 0 || (g === 'transform' && selLayers.has(layer.id)));
      rows.push(
        <div key={`G${gKey}`} className="tl-row group-row">
          <div className="tl-left prop d1 group-left" onClick={() => setGroupOpen(new Map(groupOpen).set(gKey, !gOpen))}>
            <button type="button" className="twisty" aria-expanded={gOpen}><Icon name={gOpen ? 'chevronDown' : 'chevronRight'} size={11} /></button>
            <span className="group-name">{groupLabel(g)}</span>
            {gTracks.length > 0 && <span className="group-count">{gTracks.length}</span>}
          </div>
          <div className="tl-lane" style={{ width }} onPointerDown={lanePointerDown}>
            {!gOpen && [...new Set(gTracks.flatMap((tr) => tr.keyframes.map((k) => k.t)))].map((x) => <span key={x} className="sum-key small" style={{ left: x * pps }} />)}
          </div>
        </div>,
      );
      if (gOpen) for (const p of gp) rows.push(propRow(p, 2));
    }
  }

  // Graph editor: the property rows chosen for it, else the tracks with selected keys, else the selected elements' tracks.
  let shown = graphTracks.filter((g) => graphProps.has(`${g.layer.id}|${g.track.prop}`));
  if (!shown.length) shown = graphTracks.filter((g) => g.track.keyframes.some((k) => selectedKeys.has(kid(g.track, k))));
  if (!shown.length) shown = graphTracks.filter((g) => selLayers.has(g.layer.id));
  if (!shown.length) shown = graphTracks.slice(0, 6);
  shown = shown.slice(0, 8).map((g, i) => ({ ...g, color: GRAPH_COLORS[i % GRAPH_COLORS.length] }));

  return (
    <div className="timeline" tabIndex={0} ref={rootRef} onKeyDown={onKeyDown}>
      <div className="tl-head">
        <Select value={clip.id} options={scene.animations.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => session.setSceneUI(nodeId, { clipId: v, time: 0, playing: false, selectedKeys: [] })} title={t('anim.clip')} />
        <IconButton icon="plus" size={14} title={t('anim.add')} onClick={addClip} />
        <IconButton icon="more" size={14} title={t('common.more')} onClick={(e) => openMenu(e, [
          { label: t('common.rename'), icon: 'text', onClick: async () => { const v = await store.prompt(t('common.rename'), t('common.name'), clip.name); if (v) upd(t('common.rename'), (c) => { c.name = v; }); } },
          { label: t('common.duplicate'), icon: 'duplicate', onClick: () => { const copy = JSON.parse(JSON.stringify(clip)); copy.id = newId('anm'); copy.name = `${clip.name} ${t('common.copySuffix')}`; copy.autoplay = false; updateScene(session, nodeId, t('anim.add'), (s) => { s.animations.push(copy); }); session.setSceneUI(nodeId, { clipId: copy.id }); } },
          { separator: true },
          { label: t('common.delete'), icon: 'trash', danger: true, onClick: async () => { if (!(await store.confirm(t('anim.deleteTitle'), t('anim.deleteMessage', { name: clip.name }), t('common.delete'), true))) return; updateScene(session, nodeId, t('anim.delete'), (s) => { s.animations = s.animations.filter((a) => a.id !== clip.id); }); session.setSceneUI(nodeId, { clipId: null }); } },
        ])} />
        <span className="sep" />
        <IconButton icon="skipBack" size={15} title={`${t('timeline.toStart')} (Home)`} onClick={() => { session.setSceneUI(nodeId, { playing: false }); setTime(clip.workArea?.start ?? 0); }} />
        <IconButton icon="stepBack" size={15} title={`${t('timeline.prevFrame')} (←)`} onClick={() => setTime(quant(ui.time) - 1 / fps)} />
        <IconButton icon={ui.playing ? 'pause' : 'play'} size={15} title={`${ui.playing ? t('timeline.pause') : t('timeline.play')} (Space)`} active={ui.playing} onClick={() => session.setSceneUI(nodeId, { playing: !ui.playing, time: !ui.playing && ui.time >= end ? 0 : ui.time })} />
        <IconButton icon="stepForward" size={15} title={`${t('timeline.nextFrame')} (→)`} onClick={() => setTime(quant(ui.time) + 1 / fps)} />
        <IconButton icon="record" size={15} className={cx('rec', ui.record && 'on')} title={t('timeline.recordHint')} active={ui.record} onClick={() => session.setSceneUI(nodeId, { record: !ui.record })} />
        <span className="tl-time" title={t('prefs.timeDisplay')}>{fmtTime(ui.time)}</span>
        <span className="sep" />
        <NumberInput value={clip.duration} min={0.1} step={0.1} unit="s" label={t('anim.duration')} onChange={(v) => upd(t('anim.edit'), (c) => { c.duration = v; }, 'clipdur')} />
        <Toggle value={clip.loop} onChange={(v) => upd(t('anim.edit'), (c) => { c.loop = v; })} label={t('anim.loop')} />
        <Toggle value={clip.autoplay} onChange={(v) => upd(t('anim.edit'), (c) => { c.autoplay = v; })} label={t('anim.autoplay')} title={t('anim.autoplayHint')} />
        <span className="grow" />
        <IconButton icon="marker" size={14} title={`${t('timeline.addMarker')} (M)`} onClick={addMarker} />
        <IconButton icon="workArea" size={14} active={!!clip.workArea} title={`${t('timeline.workAreaHint')} (B / N)`} onClick={() => setWorkArea(clip.workArea ? null : { start: 0, end: Math.max(0.1, clip.duration) })} />
        <IconButton icon="stopwatch" size={14} active={onlyAnimated} title={`${t('timeline.onlyAnimated')} (U)`} onClick={() => setOnlyAnimated(!onlyAnimated)} />
        <IconButton icon="graph" size={14} active={graph} title={`${t('timeline.graphEditor')} (G)`} onClick={() => setGraph(!graph)} />
        <IconButton icon="keyboard" size={14} title={t('timeline.shortcutsHint')} onClick={(e) => openMenu(e, TL_SHORTCUTS.map(([k, l]) => ({ label: t(l), hint: k, onClick: () => {} })))} />
        <input type="range" min={20} max={600} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label={t('timeline.zoom')} title={`${t('timeline.zoom')} (Ctrl/⌘ + wheel)`} className="tl-zoom" />
      </div>
      <div className="tl-body" ref={laneRef}>
        <div className="tl-inner" style={{ width: LEFT + width }}>
          <div className="tl-ruler-row">
            <div className="tl-left tl-corner">{t('timeline.layers')}</div>
            <div className="tl-ruler" style={{ width }} onPointerDown={scrub} title={`J / K ${t('timeline.jumpKeys')} · ← → ${t('timeline.frames')}`}>
              {ticks.map((x) => <div key={x} className={cx('tick', major(x) && 'major')} style={{ left: x * pps }}>{major(x) ? (prefs.timeDisplay === 'frames' ? fmtTime(x) : `${x}s`) : ''}</div>)}
              <div className="tl-end" style={{ left: clip.duration * pps }} title={t('anim.duration')} />
              {clip.workArea && (
                <div className="tl-workarea" style={{ left: clip.workArea.start * pps, width: Math.max(4, (clip.workArea.end - clip.workArea.start) * pps) }} onPointerDown={(e) => dragWorkArea(e, 'move')} title={t('timeline.workAreaHint')}>
                  <span className="wa-edge start" onPointerDown={(e) => dragWorkArea(e, 'start')} />
                  <span className="wa-edge end" onPointerDown={(e) => dragWorkArea(e, 'end')} />
                </div>
              )}
              {(clip.markers || []).map((m) => (
                <div key={m.id} className="tl-marker" style={{ left: m.t * pps }} onPointerDown={(e) => dragMarker(e, m.id)} onDoubleClick={(e) => { e.stopPropagation(); renameMarker(m.id); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(e, [{ label: t('common.rename'), icon: 'text', onClick: () => renameMarker(m.id) }, { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteMarker(m.id) }]); }}
                  title={`${m.label || t('timeline.marker')} · ${fmtTime(m.t)}`}>
                  {m.label && <span className="tl-marker-label">{m.label}</span>}
                </div>
              ))}
            </div>
          </div>
          {rows}
          {!rows.length && <div className="tl-hint muted small">{t('timeline.noElements')}</div>}
          <div className="tl-lanes-bg" style={{ left: LEFT, width, minHeight: Math.max(0, scroll.h - ROW - rows.length * ROW) }} onPointerDown={lanePointerDown} />
          {(clip.markers || []).map((m) => <div key={m.id} className="tl-marker-line" style={{ left: LEFT + m.t * pps }} />)}
          <div className="tl-playhead" style={{ left: LEFT + ui.time * pps }} />
          {graph && (
            <GraphEditor session={session} nodeId={nodeId} clip={clip} tracks={shown} pps={pps} width={width} top={scroll.top + ROW} left={LEFT} height={Math.max(120, scroll.h - ROW)} scrollLeft={scroll.left}
              selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys} time={ui.time} snap={(x, fine, skip) => snap(x, fine, snapTargets(skip))} upd={upd} t={t} />
          )}
        </div>
        {marquee && <div className="tl-marquee" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
      </div>
      {curve && curveKey && (
        <CurveEditor value={curveKey.bez || EASE_BEZ[curveKey.ease] || [0.25, 0.1, 0.25, 1]} ease={curveKey.ease} t={t} onClose={() => setCurve(null)}
          onChange={(bez) => upd(t('timeline.editCurve'), (c) => { const k = c.tracks.find((x) => x.id === curve.track)?.keyframes.find((x) => x.id === curve.key); if (k) { k.ease = 'bezier'; k.bez = bez; } }, 'curve')} />
      )}
    </div>
  );
}

const TL_SHORTCUTS: [string, string][] = [
  ['Space', 'timeline.sc.play'], ['← / →', 'timeline.sc.frame'], ['J / K', 'timeline.sc.keys'], ['Home / End', 'timeline.sc.ends'],
  ['I / O', 'timeline.sc.inout'], ['Alt+[ / Alt+]', 'timeline.sc.trim'], ['B / N', 'timeline.sc.workArea'], ['M', 'timeline.sc.marker'],
  ['U', 'timeline.sc.onlyAnimated'], ['G', 'timeline.sc.graph'], ['F9', 'timeline.sc.easyEase'], ['Alt+drag', 'timeline.sc.stretch'],
  ['Shift+drag', 'timeline.sc.fine'], ['Ctrl/⌘+wheel', 'timeline.sc.zoom'],
];

function followsLayer(scene: SceneData, id: string, of: string): boolean {
  let p = scene.layers.find((l) => l.id === id)?.link;
  for (let i = 0; p && i < 64; i++) { if (p === of) return true; p = scene.layers.find((l) => l.id === p)?.link; }
  return false;
}

/** A number you can drag left/right to change (Shift ×10, Alt ×0.1) or click to type. */
function ScrubValue({ value, step, min, max, onChange }: { value: number; step: number; min?: number; max?: number; onChange: (v: number, transient?: boolean) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  if (edit !== null) {
    return <input className="scrub-input" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={() => { const v = Number(edit); if (Number.isFinite(v)) onChange(clamp(v)); setEdit(null); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null); }} />;
  }
  return (
    <span className="scrub-val" onPointerDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, v0 = value;
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        document.body.classList.add('scrubbing');
        const f = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        onChange(clamp(Math.round((v0 + dx * step * f) / (step * (ev.altKey ? 0.1 : 1))) * (step * (ev.altKey ? 0.1 : 1))), true);
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('scrubbing'); if (!moved) setEdit(String(Math.round(value * 1000) / 1000)); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }}>{Number(value.toFixed(digits)).toString()}</span>
  );
}

/* ------------------------------------------------------------------ */
/* Graph editor                                                         */
/* ------------------------------------------------------------------ */

function GraphEditor({ session, clip, tracks, pps, width, top, left, height, scrollLeft, selectedKeys, setSelectedKeys, time, snap, upd, t }: {
  session: ProjectSession; nodeId: string; clip: AnimationClip; tracks: { track: Track; label: string; color: string; def?: PropDef }[];
  pps: number; width: number; top: number; left: number; height: number; scrollLeft: number; selectedKeys: Set<string>; setSelectedKeys: (ids: Iterable<string>) => void;
  time: number; snap: (t: number, fine: boolean, skip: Set<string>) => number; upd: (label: string, fn: (c: AnimationClip) => void, mk?: string) => void; t: (k: string, p?: any) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const PAD = 24;
  const end = Math.max(clip.duration, clipEnd(clip));
  // Value range over every shown curve (sampled) and its handles.
  let lo = Infinity, hi = -Infinity;
  const curves = tracks.map(({ track, color, label, def }) => {
    const pts: [number, number][] = [];
    const step = Math.max(1 / 120, 3 / pps);
    const kind = propKind(def, track.keyframes[0]?.v);
    for (let x = 0; x <= end + 1e-9; x += step) { const v = Number(sampleTrack(session.engine, track, x, kind)); if (Number.isFinite(v)) { pts.push([x, v]); lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    for (const k of track.keyframes) { const v = Number(k.v); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    return { track, color, label, pts };
  });
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.12; hi += span * 0.12;
  const vToY = (v: number) => PAD + ((hi - v) / (hi - lo)) * (height - PAD * 2);
  const yToV = (y: number) => hi - ((y - PAD) / (height - PAD * 2)) * (hi - lo);
  const local = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const grid: number[] = [];
  const raw = (hi - lo) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const gstep = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  for (let v = Math.ceil(lo / gstep) * gstep; v <= hi; v += gstep) grid.push(Math.round(v * 1e6) / 1e6);

  const dragKey = (e: React.PointerEvent, tr: Track, k: Keyframe) => {
    e.preventDefault();
    e.stopPropagation();
    const id = kid(tr, k);
    let sel = new Set(selectedKeys);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); } else if (!sel.has(id)) sel = new Set([id]);
    setSelectedKeys(sel);
    const p0 = local(e);
    const starts = new Map<string, { t: number; v: number }>();
    for (const g of tracks) for (const x of g.track.keyframes) if (sel.has(kid(g.track, x)) && typeof x.v === 'number') starts.set(kid(g.track, x), { t: x.t, v: x.v });
    const mk = `gk-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
      moved = true;
      let dt = snap(k.t + (p.x - p0.x) / pps, ev.shiftKey, sel) - k.t;
      let dv = yToV(p.y) - yToV(p0.y);
      // Shift: move along one axis only.
      if (ev.shiftKey) { if (Math.abs(p.x - p0.x) > Math.abs(p.y - p0.y)) dv = 0; else dt = 0; }
      upd(t('timeline.editKeys'), (c) => {
        for (const tr2 of c.tracks) {
          let touched = false;
          for (const x of tr2.keyframes) { const s = starts.get(kid(tr2, x)); if (!s) continue; x.t = Math.max(0, Math.round((s.t + dt) * 1000) / 1000); x.v = Math.round((s.v + dv) * 1000) / 1000; touched = true; }
          if (touched) tr2.keyframes.sort((a, b) => a.t - b.t);
        }
      }, mk);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) upd(t('timeline.editKeys'), (c) => { for (const x of c.tracks) normalizeTrack(x); }, mk); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag one bezier handle of the segment that starts at key `a` (0 = leaving a, 1 = arriving at b). */
  const dragHandle = (e: React.PointerEvent, tr: Track, a: Keyframe, b: Keyframe, which: 0 | 1) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = b.t - a.t, dv = Number(b.v) - Number(a.v);
    const mk = `gh-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      const x = Math.max(0, Math.min(1, (p.x / pps - a.t) / dt));
      const y = (yToV(p.y) - Number(a.v)) / dv;
      upd(t('timeline.editCurve'), (c) => {
        const k = c.tracks.find((q) => q.id === tr.id)?.keyframes.find((q) => q.id === a.id);
        if (!k) return;
        const bez = [...(k.bez || EASE_BEZ[k.ease] || [0.25, 0.1, 0.25, 1])] as [number, number, number, number];
        bez[which * 2] = Math.round(x * 1000) / 1000;
        bez[which * 2 + 1] = Math.round(Math.max(-3, Math.min(4, y)) * 1000) / 1000;
        k.ease = 'bezier';
        k.bez = bez;
      }, mk);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const bgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = add ? new Set(selectedKeys) : new Set<string>();
    const p0 = local(e);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
      moved = true;
      const r = { x0: Math.min(p0.x, p.x), y0: Math.min(p0.y, p.y), x1: Math.max(p0.x, p.x), y1: Math.max(p0.y, p.y) };
      setBox(r);
      const sel = new Set(base);
      for (const g of tracks) for (const k of g.track.keyframes) { const x = k.t * pps, y = vToY(Number(k.v)); if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) sel.add(kid(g.track, k)); }
      setSelectedKeys(sel);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setBox(null); if (!moved && !add) setSelectedKeys([]); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="tl-graph" style={{ top, left, width, height }}>
      <svg ref={svgRef} width={width} height={height} onPointerDown={bgDown}>
        {grid.map((v) => <g key={v}><line x1={0} x2={width} y1={vToY(v)} y2={vToY(v)} className="g-grid" /><text x={scrollLeft + 6} y={vToY(v) - 3} className="g-label">{Math.round(v * 1000) / 1000}</text></g>)}
        <line x1={time * pps} x2={time * pps} y1={0} y2={height} className="g-playhead" />
        {curves.map((c) => <polyline key={c.track.id} points={c.pts.map(([x, v]) => `${x * pps},${vToY(v)}`).join(' ')} className="g-curve" style={{ stroke: c.color }} />)}
        {curves.map((c) => c.track.keyframes.map((k, i) => {
          if (typeof k.v !== 'number') return null;
          const next = c.track.keyframes[i + 1];
          const sel = selectedKeys.has(kid(c.track, k));
          const prev = c.track.keyframes[i - 1];
          const out: JSX.Element[] = [];
          // Handles of the segments next to a selected key.
          const seg = (a: Keyframe, b: Keyframe) => {
            if (typeof b.v !== 'number' || Math.abs(Number(b.v) - Number(a.v)) < 1e-9 || a.ease === 'step') return;
            const bz = a.bez || EASE_BEZ[a.ease];
            if (!bz) return;
            const dt = b.t - a.t, dv = Number(b.v) - Number(a.v);
            const h0 = { x: (a.t + bz[0] * dt) * pps, y: vToY(Number(a.v) + bz[1] * dv) };
            const h1 = { x: (a.t + bz[2] * dt) * pps, y: vToY(Number(a.v) + bz[3] * dv) };
            out.push(<g key={`h${a.id}`} className="g-handles">
              <line x1={a.t * pps} y1={vToY(Number(a.v))} x2={h0.x} y2={h0.y} /><line x1={b.t * pps} y1={vToY(Number(b.v))} x2={h1.x} y2={h1.y} />
              <circle cx={h0.x} cy={h0.y} r={4.5} onPointerDown={(e) => dragHandle(e, c.track, a, b, 0)} /><circle cx={h1.x} cy={h1.y} r={4.5} onPointerDown={(e) => dragHandle(e, c.track, a, b, 1)} />
            </g>);
          };
          if (sel && next) seg(k, next);
          if (sel && prev && !selectedKeys.has(kid(c.track, prev))) seg(prev, k);
          return <g key={k.id}>{out}<rect x={k.t * pps - 4.5} y={vToY(k.v) - 4.5} width={9} height={9} className={cx('g-key', sel && 'selected')} style={{ stroke: c.color }}
            transform={`rotate(45 ${k.t * pps} ${vToY(k.v)})`} onPointerDown={(e) => dragKey(e, c.track, k)}><title>{`${c.label} · ${fmtTime(k.t)} · ${Math.round(k.v * 1000) / 1000}`}</title></rect></g>;
        }))}
        {box && <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} className="g-box" />}
      </svg>
      <div className="g-legend" style={{ left: scrollLeft + 8 }}>
        {tracks.length ? tracks.map((g) => <span key={g.track.id}><i style={{ background: g.color }} />{g.label}</span>) : <span className="muted">{t('timeline.graphEmpty')}</span>}
      </div>
    </div>
  );
}

/** Cubic-bezier easing editor with draggable handles and presets. */
function CurveEditor({ value, onChange, onClose, t }: { value: [number, number, number, number]; ease: string; onChange: (b: [number, number, number, number]) => void; onClose: () => void; t: (k: string) => string }) {
  const S = 220, P = 30;
  const [b, setB] = useState(value);
  const toX = (x: number) => P + x * S, toY = (y: number) => P + (1 - y) * S;
  const drag = (i: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const svg = (e.target as SVGElement).ownerSVGElement!;
    const move = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left - P) / S));
      const y = Math.max(-0.5, Math.min(1.5, 1 - (ev.clientY - r.top - P) / S));
      const nb = [...b] as [number, number, number, number];
      nb[i * 2] = Math.round(x * 100) / 100;
      nb[i * 2 + 1] = Math.round(y * 100) / 100;
      setB(nb);
      onChange(nb);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) { const u = i / 40; pts.push(`${toX(u)},${toY(cubicBezier(b[0], b[1], b[2], b[3], u))}`); }
  const presets: [string, [number, number, number, number]][] = [['ease.linear', [0, 0, 1, 1]], ['ease.in', [0.55, 0, 1, 0.45]], ['ease.out', [0, 0.55, 0.45, 1]], ['ease.inOut', [0.65, 0, 0.35, 1]], ['ease.backOut', [0.34, 1.56, 0.64, 1]]];
  return (
    <Modal title={t('timeline.editCurve')} onClose={onClose} width={340} footer={<Button kind="primary" onClick={onClose}>{t('common.done')}</Button>}>
      <svg width={S + P * 2} height={S + P * 2} className="curve-svg">
        <rect x={P} y={P} width={S} height={S} className="curve-bg" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(b[0])} y2={toY(b[1])} className="curve-arm" />
        <line x1={toX(1)} y1={toY(1)} x2={toX(b[2])} y2={toY(b[3])} className="curve-arm" />
        <polyline points={pts.join(' ')} className="curve-line" />
        <circle cx={toX(b[0])} cy={toY(b[1])} r={7} className="curve-handle" onPointerDown={drag(0)} />
        <circle cx={toX(b[2])} cy={toY(b[3])} r={7} className="curve-handle" onPointerDown={drag(1)} />
      </svg>
      <div className="row-inline wrap">{presets.map(([l, p]) => <Button key={l} small onClick={() => { setB(p); onChange(p); }}>{t(l)}</Button>)}</div>
      <code className="muted small">cubic-bezier({b.join(', ')})</code>
    </Modal>
  );
}
