import { useEffect, useRef, useState } from 'react';
import type { AnimationClip, Keyframe, SceneData, Track, Layer } from '@vne/core';
import { newId, createAnimation } from '@vne/core';
import { normalizeTrack, clipEnd, sampleTrack, propKind, cubicBezier } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { sceneOf, updateScene, layerTree, clipOf } from './sceneOps';
import { IconButton, NumberInput, Select, Toggle, Button, cx, Kbd } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu, MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';

const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'bounce', 'elastic', 'step', 'bezier'];
const LEFT = 232;

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function Timeline({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const scene = sceneOf(session, nodeId)!;
  const ui = session.sceneUI(nodeId);
  const clip = clipOf(scene, ui.clipId) || null;
  const [pps, setPps] = useState(() => Number(localStorage.getItem('vne.timeline.pps')) || 120);
  const [curve, setCurve] = useState<{ track: string; key: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const laneRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef(new Map<string, HTMLAudioElement>());

  // Pick the first clip automatically.
  useEffect(() => { if (!clip && scene.animations[0]) session.setSceneUI(nodeId, { clipId: scene.animations[0].id }); }, [clip, scene.animations.length]);
  useEffect(() => { localStorage.setItem('vne.timeline.pps', String(pps)); }, [pps]);

  // Playback loop (editor-side). Audio clips play in sync; the canvas samples the clip at the playhead.
  useEffect(() => {
    if (!ui.playing || !clip) return;
    let raf = 0;
    let last = performance.now();
    const end = Math.max(0.1, clipEnd(clip));
    const step = (now: number) => {
      const s = session.sceneUI(nodeId);
      let time = s.time + (now - last) / 1000;
      last = now;
      if (time >= end) {
        if (clip.loop) { time = time % end; stopAudio(); }
        else { session.setSceneUI(nodeId, { time: end, playing: false }); stopAudio(); return; }
      }
      syncAudio(time);
      session.setSceneUI(nodeId, { time });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); stopAudio(); };
  }, [ui.playing, clip?.id]);

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

  const setTime = (time: number) => session.setSceneUI(nodeId, { time: Math.max(0, Math.round(time * 100) / 100) });
  const upd = (label: string, fn: (c: AnimationClip, s: SceneData) => void, mk?: string) => updateScene(session, nodeId, label, (s) => { const c = s.animations.find((a) => a.id === ui.clipId); if (c) fn(c, s); }, mk);

  const addClip = () => {
    const c = createAnimation(t('anim.defaultName', { n: scene.animations.length + 1 }), 3);
    if (!scene.animations.length) c.autoplay = true;
    updateScene(session, nodeId, t('anim.add'), (s) => { s.animations.push(c); });
    session.setSceneUI(nodeId, { clipId: c.id, time: 0 });
  };

  if (!clip) {
    return (
      <div className="timeline empty-tl">
        <div className="empty">
          <Icon name="timeline" size={26} className="empty-icon" />
          <div className="empty-title">{t('timeline.emptyTitle')}</div>
          <div className="empty-text">{t('timeline.emptyText')}</div>
          <Button kind="primary" icon="plus" onClick={addClip}>{t('anim.add')}</Button>
        </div>
      </div>
    );
  }

  const end = Math.max(clip.duration, clipEnd(clip));
  const width = Math.max(600, (end + 1) * pps);
  const selLayers = new Set(ui.selectedLayers);
  const rowsLayers = layerTree(scene).map((r) => r.layer).filter((l) => clip.tracks.some((tr) => tr.layerId === l.id) || clip.media.some((m) => m.layerId === l.id) || selLayers.has(l.id));
  const selectedKeys = new Set(ui.selectedKeys);

  const xToTime = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + laneRef.current!.scrollLeft - LEFT) / pps);
  };

  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    session.setSceneUI(nodeId, { playing: false });
    setTime(xToTime(e.clientX));
    const move = (ev: PointerEvent) => setTime(snapTime(xToTime(ev.clientX), ev.shiftKey));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const snapTime = (time: number, fine: boolean) => (fine ? Math.round(time * 100) / 100 : Math.round(time * 20) / 20);

  const dragKeys = (e: React.PointerEvent, track: Track, key: Keyframe) => {
    e.stopPropagation();
    e.preventDefault();
    const id = `${track.id}:${key.id}`;
    let sel = new Set(selectedKeys);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); }
    else if (!sel.has(id)) sel = new Set([id]);
    session.setSceneUI(nodeId, { selectedKeys: [...sel], selectedLayers: [track.layerId] });
    const t0 = xToTime(e.clientX);
    const starts = new Map<string, number>();
    for (const tr of clip.tracks) for (const k of tr.keyframes) if (sel.has(`${tr.id}:${k.id}`)) starts.set(`${tr.id}:${k.id}`, k.t);
    const mk = `kdrag-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dt = xToTime(ev.clientX) - t0;
      if (!moved && Math.abs(dt * pps) < 3) return;
      moved = true;
      upd(t('timeline.moveKeys'), (c) => {
        for (const tr of c.tracks) {
          let touched = false;
          for (const k of tr.keyframes) {
            const s = starts.get(`${tr.id}:${k.id}`);
            if (s === undefined) continue;
            k.t = Math.max(0, snapTime(s + dt, ev.shiftKey));
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

  const keyMenu = (e: React.MouseEvent, track: Track, key: Keyframe) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = selectedKeys.has(`${track.id}:${key.id}`) ? selectedKeys : new Set([`${track.id}:${key.id}`]);
    const setEase = (ease: string) => upd(t('timeline.setEase'), (c) => { for (const tr of c.tracks) for (const k of tr.keyframes) if (ids.has(`${tr.id}:${k.id}`)) { k.ease = ease; if (ease === 'bezier' && !k.bez) k.bez = [0.25, 0.1, 0.25, 1]; } });
    const items: MenuItem[] = [
      { header: true, label: t('timeline.interpolation') },
      ...session.engine.interpolators.list().filter((i) => EASES.includes(i.id) || (i.owner && i.owner !== 'core')).map((i) => ({ label: t(i.label), checked: key.ease === i.id, onClick: () => setEase(i.id) })),
      { label: t('timeline.editCurve'), icon: 'curve', onClick: () => { setEase('bezier'); setCurve({ track: track.id, key: key.id }); } },
      { separator: true },
      { label: t('common.copy'), icon: 'copy', onClick: () => copyKeys(ids) },
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteKeys(ids) },
    ];
    openMenu(e, items);
  };

  const deleteKeys = (ids: Set<string>) => {
    upd(t('timeline.deleteKeys'), (c) => {
      for (const tr of c.tracks) tr.keyframes = tr.keyframes.filter((k) => !ids.has(`${tr.id}:${k.id}`));
      c.tracks = c.tracks.filter((tr) => tr.keyframes.length);
    });
    session.setSceneUI(nodeId, { selectedKeys: [] });
  };

  const copyKeys = (ids: Set<string>) => {
    const items: { layerId: string; prop: string; t: number; v: any; ease: string; bez?: any }[] = [];
    for (const tr of clip.tracks) for (const k of tr.keyframes) if (ids.has(`${tr.id}:${k.id}`)) items.push({ layerId: tr.layerId, prop: tr.prop, t: k.t, v: k.v, ease: k.ease, bez: k.bez });
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
    upd(t('timeline.pasteKeys'), (c) => {
      for (const it of items) {
        const layerId = targetLayer && sameLayer ? targetLayer : it.layerId;
        if (!scene.layers.some((l) => l.id === layerId)) continue;
        let tr = c.tracks.find((x) => x.layerId === layerId && x.prop === it.prop);
        if (!tr) { tr = { id: newId('trk'), layerId, prop: it.prop, keyframes: [] }; c.tracks.push(tr); }
        const time = Math.round((ui.time + it.t) * 100) / 100;
        tr.keyframes = tr.keyframes.filter((k) => Math.abs(k.t - time) > 1e-3);
        tr.keyframes.push({ id: newId('key'), t: time, v: it.v, ease: it.ease, bez: it.bez });
        normalizeTrack(tr);
        if (time > c.duration) c.duration = Math.ceil(time * 10) / 10;
      }
    });
  };

  const addTrack = (layer: Layer, prop: string) => {
    const def = session.engine.layerProps(layer.type).find((p) => p.key === prop);
    upd(t('timeline.addTrack'), (c) => {
      if (c.tracks.some((x) => x.layerId === layer.id && x.prop === prop)) return;
      c.tracks.push({ id: newId('trk'), layerId: layer.id, prop, keyframes: [{ id: newId('key'), t: ui.time, v: layer.props[prop] ?? def?.default ?? 0, ease: 'easeInOut' }] });
    });
  };

  const addMedia = (layer: Layer) => upd(t('timeline.addMedia'), (c) => { if (!c.media.some((m) => m.layerId === layer.id)) c.media.push({ id: newId('med'), layerId: layer.id, start: ui.time, trimIn: 0, duration: null }); });

  const dragMedia = (e: React.PointerEvent, mid: string, mode: 'move' | 'in' | 'out', assetDur: number) => {
    e.preventDefault();
    e.stopPropagation();
    const m0 = clip.media.find((m) => m.id === mid)!;
    const t0 = xToTime(e.clientX);
    const mk = `media-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const dt = snapTime(xToTime(ev.clientX) - t0, ev.shiftKey);
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

  const ticks: number[] = [];
  const stepT = pps > 200 ? 0.1 : pps > 80 ? 0.5 : pps > 30 ? 1 : 5;
  for (let x = 0; x <= end + 1; x += stepT) ticks.push(Math.round(x * 100) / 100);

  const curveKey = curve ? clip.tracks.find((tr) => tr.id === curve.track)?.keyframes.find((k) => k.id === curve.key) : null;

  return (
    <div className="timeline" tabIndex={0} onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') { e.preventDefault(); session.setSceneUI(nodeId, { playing: !ui.playing }); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeys.size) { e.preventDefault(); deleteKeys(selectedKeys); }
      else if (mod && e.key.toLowerCase() === 'c' && selectedKeys.size) { e.preventDefault(); copyKeys(selectedKeys); }
      else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteKeys(); }
      else if (e.key === 'Home') setTime(0);
      else if (e.key === 'End') setTime(end);
      else if (e.key === ',' || e.key === '.') {
        const all = [...new Set(clip.tracks.flatMap((tr) => tr.keyframes.map((k) => k.t)))].sort((a, b) => a - b);
        const next = e.key === '.' ? all.find((x) => x > ui.time + 1e-3) : [...all].reverse().find((x) => x < ui.time - 1e-3);
        if (next !== undefined) setTime(next);
      }
    }}>
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
        <IconButton icon="skipBack" size={15} title={t('timeline.toStart')} onClick={() => { session.setSceneUI(nodeId, { playing: false }); setTime(0); }} />
        <IconButton icon={ui.playing ? 'pause' : 'play'} size={15} title={`${ui.playing ? t('timeline.pause') : t('timeline.play')} (Space)`} active={ui.playing} onClick={() => session.setSceneUI(nodeId, { playing: !ui.playing, time: !ui.playing && ui.time >= end ? 0 : ui.time })} />
        <IconButton icon="record" size={15} className={cx('rec', ui.record && 'on')} title={t('timeline.recordHint')} active={ui.record} onClick={() => session.setSceneUI(nodeId, { record: !ui.record })} />
        <span className="tl-time">{fmtTime(ui.time)}</span>
        <span className="sep" />
        <NumberInput value={clip.duration} min={0.1} step={0.1} unit="s" label={t('anim.duration')} onChange={(v) => upd(t('anim.edit'), (c) => { c.duration = v; }, 'clipdur')} />
        <Toggle value={clip.loop} onChange={(v) => upd(t('anim.edit'), (c) => { c.loop = v; })} label={t('anim.loop')} />
        <Toggle value={clip.autoplay} onChange={(v) => upd(t('anim.edit'), (c) => { c.autoplay = v; })} label={t('anim.autoplay')} title={t('anim.autoplayHint')} />
        <span className="grow" />
        <span className="muted small hint-keys"><Kbd>,</Kbd><Kbd>.</Kbd> {t('timeline.jumpKeys')}</span>
        <input type="range" min={20} max={400} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label={t('timeline.zoom')} title={t('timeline.zoom')} className="tl-zoom" />
      </div>
      <div className="tl-body" ref={laneRef}>
        <div className="tl-inner" style={{ width: LEFT + width }}>
          <div className="tl-ruler-row">
            <div className="tl-left tl-corner">{t('timeline.layers')}</div>
            <div className="tl-ruler" style={{ width }} onPointerDown={scrub}>
              {ticks.map((x) => <div key={x} className={cx('tick', Math.abs(x - Math.round(x)) < 1e-6 && 'major')} style={{ left: x * pps }}>{Math.abs(x - Math.round(x)) < 1e-6 ? `${x}s` : ''}</div>)}
              <div className="tl-end" style={{ left: clip.duration * pps }} title={t('anim.duration')} />
            </div>
          </div>
          {!rowsLayers.length && <div className="tl-hint muted">{t('timeline.selectLayer')}</div>}
          {rowsLayers.map((layer) => {
            const tracks = clip.tracks.filter((tr) => tr.layerId === layer.id);
            const media = clip.media.filter((m) => m.layerId === layer.id);
            const props = session.engine.layerProps(layer.type).filter((p) => p.animatable);
            const fxParams = layer.effect?.kind === 'inline' ? layer.effect.graph.params : [];
            const isMedia = layer.type === 'core.audio' || layer.type === 'core.video';
            const open = !collapsed.has(layer.id);
            const assetDur = Number(session.project.assets.find((a) => a.id === layer.props.assetId)?.meta.duration || 5);
            return (
              <div key={layer.id} className={cx('tl-layer', selLayers.has(layer.id) && 'active')}>
                <div className="tl-row layer-head">
                  <div className="tl-left" onClick={() => session.setSceneUI(nodeId, { selectedLayers: [layer.id] })}>
                    <button type="button" className="twisty" onClick={(e) => { e.stopPropagation(); const s = new Set(collapsed); if (open) s.add(layer.id); else s.delete(layer.id); setCollapsed(s); }}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></button>
                    <span className="tl-layer-name">{layer.name}</span>
                    <IconButton icon="plus" size={13} title={t('timeline.addProperty')} onClick={(e) => { e.stopPropagation(); openMenu(e, [
                      ...props.filter((p) => !tracks.some((tr) => tr.prop === p.key)).map((p) => ({ label: t(p.label), icon: 'keyframe', onClick: () => addTrack(layer, p.key) })),
                      ...fxParams.filter((p) => !tracks.some((tr) => tr.prop === `fx.${p.id}`)).map((p) => ({ label: `${t('effects.param')}: ${p.name}`, icon: 'sparkles', onClick: () => addTrack(layer, `fx.${p.id}`) })),
                      ...(isMedia && !media.length ? [{ separator: true } as MenuItem, { label: t('timeline.addMedia'), icon: 'music', onClick: () => addMedia(layer) }] : []),
                    ], { search: props.length > 10 }); }} />
                  </div>
                  <div className="tl-lane summary" style={{ width }}>
                    {[...new Set(tracks.flatMap((tr) => tr.keyframes.map((k) => k.t)))].map((x) => <span key={x} className="sum-key" style={{ left: x * pps }} />)}
                  </div>
                </div>
                {open && media.map((m) => {
                  const dur = m.duration ?? Math.max(0.1, assetDur - m.trimIn);
                  return (
                    <div key={m.id} className="tl-row">
                      <div className="tl-left prop"><Icon name={layer.type === 'core.audio' ? 'music' : 'film'} size={12} /><span>{t('timeline.mediaClip')}</span>
                        <IconButton icon="close" size={12} title={t('common.remove')} onClick={() => upd(t('timeline.removeMedia'), (c) => { c.media = c.media.filter((x) => x.id !== m.id); })} /></div>
                      <div className="tl-lane" style={{ width }}>
                        <div className="media-bar" style={{ left: m.start * pps, width: Math.max(8, dur * pps) }} onPointerDown={(e) => dragMedia(e, m.id, 'move', assetDur)} title={`${t('timeline.start')}: ${m.start.toFixed(2)}s · ${t('timeline.trim')}: ${m.trimIn.toFixed(2)}s`}>
                          <span className="media-edge in" onPointerDown={(e) => dragMedia(e, m.id, 'in', assetDur)} />
                          <span className="media-label">{session.project.assets.find((a) => a.id === layer.props.assetId)?.name || layer.name}</span>
                          <span className="media-edge out" onPointerDown={(e) => dragMedia(e, m.id, 'out', assetDur)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {open && tracks.map((tr) => {
                  const def = session.engine.layerProps(layer.type).find((p) => p.key === tr.prop);
                  const label = def ? t(def.label) : tr.prop.startsWith('fx.') ? `${t('effects.param')}: ${fxParams.find((p) => `fx.${p.id}` === tr.prop)?.name || tr.prop}` : tr.prop;
                  const val = sampleTrack(session.engine, tr, ui.time, propKind(def, tr.keyframes[0]?.v));
                  const atKey = tr.keyframes.find((k) => Math.abs(k.t - ui.time) < 1e-3);
                  return (
                    <div key={tr.id} className="tl-row">
                      <div className="tl-left prop">
                        <span className="prop-name" title={label}>{label}</span>
                        <span className="prop-val">{typeof val === 'number' ? Math.round(val * 100) / 100 : String(val ?? '').slice(0, 10)}</span>
                        <IconButton icon="keyframe" size={12} className={cx('key-toggle', atKey ? 'key' : 'animated')} title={atKey ? t('timeline.removeKey') : t('timeline.addKey')}
                          onClick={() => upd(t('timeline.toggleKey'), (c) => {
                            const x = c.tracks.find((y) => y.id === tr.id)!;
                            if (atKey) { x.keyframes = x.keyframes.filter((k) => k.id !== atKey.id); if (!x.keyframes.length) c.tracks = c.tracks.filter((y) => y.id !== tr.id); }
                            else { x.keyframes.push({ id: newId('key'), t: ui.time, v: val, ease: 'easeInOut' }); normalizeTrack(x); }
                          })} />
                        <IconButton icon="close" size={12} title={t('timeline.removeTrack')} onClick={() => upd(t('timeline.removeTrack'), (c) => { c.tracks = c.tracks.filter((y) => y.id !== tr.id); })} />
                      </div>
                      <div className="tl-lane" style={{ width }} onDoubleClick={(e) => {
                        const time = snapTime(xToTime(e.clientX), e.shiftKey);
                        const v = sampleTrack(session.engine, tr, time, propKind(def, tr.keyframes[0]?.v));
                        upd(t('timeline.addKey'), (c) => { const x = c.tracks.find((y) => y.id === tr.id)!; x.keyframes.push({ id: newId('key'), t: time, v, ease: 'easeInOut' }); normalizeTrack(x); });
                        setTime(time);
                      }}>
                        {tr.keyframes.map((k, i) => {
                          const next = tr.keyframes[i + 1];
                          return (
                            <span key={k.id}>
                              {next && <span className={cx('key-span', k.ease === 'step' && 'step')} style={{ left: k.t * pps, width: (next.t - k.t) * pps }} />}
                              <span className={cx('tl-key', `ease-${k.ease}`, selectedKeys.has(`${tr.id}:${k.id}`) && 'selected')} style={{ left: k.t * pps }}
                                onPointerDown={(e) => dragKeys(e, tr, k)} onContextMenu={(e) => keyMenu(e, tr, k)} onDoubleClick={(e) => { e.stopPropagation(); setCurve({ track: tr.id, key: k.id }); }}
                                title={`${k.t.toFixed(2)}s · ${typeof k.v === 'number' ? Math.round(k.v * 100) / 100 : k.v} · ${t(session.engine.interpolators.get(k.ease)?.label || k.ease)}`} />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="tl-playhead" style={{ left: LEFT + ui.time * pps }} />
        </div>
      </div>
      {curve && curveKey && (
        <CurveEditor value={curveKey.bez || [0.25, 0.1, 0.25, 1]} ease={curveKey.ease} t={t} onClose={() => setCurve(null)}
          onChange={(bez) => upd(t('timeline.editCurve'), (c) => { const k = c.tracks.find((x) => x.id === curve.track)?.keyframes.find((x) => x.id === curve.key); if (k) { k.ease = 'bezier'; k.bez = bez; } }, 'curve')} />
      )}
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
