import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, LayerInstance, SceneData, Engine, Project } from '@vne/core';
import { sceneLines, GLOBAL_NODE_ID, ensureGlobalNode, ensureInventoryVar, newId } from '@vne/core';
import { Stage, NarrativeUI, createEditView, drawScene, hitTest, regionPoints, worldMatrix, layerCorners, layerSize, CanvasPool, ShaderRunner, invert, apply, VarStore, portraitAsset, interpolateVarsCompat, layerMatrix, parentSpace, sampleTrack, clipEnd, normalizeTrack } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { setLayerProps, addLayer, deleteLayers, duplicateLayers, sceneOf, updateScene } from './sceneOps';
import { pageCtx, openGlobalPage, moveElements } from './pageContext';
import { IconButton, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu } from '../ui/Menu';
import { importFiles } from '../sidebar/AssetLibrary';

interface Guide { x?: number; y?: number }

export function CompositionCanvas({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const narrRef = useRef<NarrativeUI | null>(null);
  const poolRef = useRef(new CanvasPool());
  const shadersRef = useRef(new ShaderRunner());
  const instancesRef = useRef(new Map<string, { key: string; inst: LayerInstance }>());
  const [, force] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [spaceDown, setSpaceDown] = useState(false);
  const project = session.project;
  const scene = sceneOf(session, nodeId)!;
  const ui = session.sceneUI(nodeId);
  const { width: W, height: H } = project.settings.resolution;
  const varsRef = useRef<VarStore | null>(null);
  if (!varsRef.current) varsRef.current = new VarStore(() => session.project, null);

  // Create the stage once; it is the same presentation surface the game uses.
  useEffect(() => {
    const host = hostRef.current!;
    const stage = new Stage(host, W, H, { fit: 'manual', background: 'transparent' });
    stage.wrap.classList.add('edit-stage');
    stageRef.current = stage;
    narrRef.current = new NarrativeUI(stage.overlay);
    stage.overlay.style.pointerEvents = 'none';
    stage.onResize = () => force((x) => x + 1);
    const v = session.sceneUI(nodeId).view;
    if (v) stage.setView(v.zoom, v.x, v.y);
    else { const f = stage.fitScale(); stage.setView(f.scale * 0.92, f.offsetX + (stage.width * f.scale * 0.04), f.offsetY + (stage.height * f.scale * 0.04)); }
    session.assets.onLoad = () => force((x) => x + 1);
    return () => {
      for (const { inst } of instancesRef.current.values()) inst.dispose?.();
      instancesRef.current.clear();
      narrRef.current?.dispose();
      stage.dispose();
      stageRef.current = null;
    };
  }, [nodeId]);

  useEffect(() => { stageRef.current?.setResolution(W, H); }, [W, H]);

  // Media instances for video previews in the editor.
  useEffect(() => {
    const map = instancesRef.current;
    const keep = new Set<string>();
    for (const l of scene.layers) {
      if (l.type !== 'core.video') continue;
      const key = `${l.props.assetId}`;
      keep.add(l.id);
      const cur = map.get(l.id);
      if (cur && cur.key === key) continue;
      cur?.inst.dispose?.();
      const def = session.engine.layerTypes.get(l.type);
      const inst = def?.createInstance?.(l, { assets: session.assets, audio: { track: () => ({ setBase() {}, untrack() {} }), playMusic() {}, stopMusic() {} }, mode: 'edit', emit() {}, requestRender: () => force((x) => x + 1) });
      if (inst) map.set(l.id, { key, inst });
    }
    for (const [id, v] of map) if (!keep.has(id)) { v.inst.dispose?.(); map.delete(id); }
  }, [scene.layers]);

  // Read live: instances are created in an effect after the first render.
  const liveInstances = () => new Map([...instancesRef.current].map(([k, v]) => [k, v.inst]));

  // Global elements and elements inherited from earlier pages are drawn too (not editable here).
  const pc = pageCtx(session, nodeId);
  const inheritedLayers = session.ui.showContext === false ? [] : pc.inherited.map((e) => e.layer);
  const context = session.ui.showContext === false ? { under: [], over: [] } : {
    under: [...pc.globalBack, ...inheritedLayers.filter((l) => l.type === 'core.background')],
    over: [...inheritedLayers.filter((l) => l.type !== 'core.background'), ...pc.globalFront],
  };
  const ownIds = new Set(scene.layers.map((l) => l.id));
  const buildView = () => createEditView({
    engine: session.engine, project, scene, assets: session.assets, pool: poolRef.current, shaders: shadersRef.current,
    time: ui.time, clipIds: ui.clipId ? [ui.clipId] : [], vars: varsRef.current!, instances: liveInstances(), context,
  });

  // Render: on change, and continuously while playing or when the scene has moving content.
  const moving = scene.layers.some((l) => l.type === 'core.particles' || layerMovesOverTime(session.engine, session.project, l));
  const continuous = ui.playing || moving || scene.layers.some((l) => l.type === 'core.video');
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const t0 = performance.now();
    const draw = () => {
      const stage = stageRef.current;
      if (!stage || !alive) return;
      const view = buildView();
      if (continuous && !ui.playing) view.time = ui.time + (performance.now() - t0) / 1000 * (moving ? 1 : 0);
      for (const l of scene.layers) view.instance(l.id)?.update?.(0, view.props(l), view.time);
      const ctx = stage.begin();
      try { drawScene(ctx, view, scene.background || '#000'); } catch (err) { console.error(err); }
      poolRef.current.releaseAll();
      if (continuous) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { alive = false; cancelAnimationFrame(raf); };
  });

  // Dialogue preview in the real text box (choices are elements drawn on the canvas).
  const lines = sceneLines(scene);
  useEffect(() => {
    const n = narrRef.current;
    if (!n) return;
    n.applyStyle(project.settings.textbox);
    const line = lines.find((l) => l.id === ui.selectedLine) || lines[0];
    if (!ui.showTextbox || scene.hideTextbox) { n.renderStatic(null, null, false); return; }
    if (!line) { n.renderStatic(null, null, false); return; }
    const ch = project.characters.find((c) => c.id === line.speakerId);
    const pa = ch ? portraitAsset(project, ch.id, line.portraitId || null) : null;
    n.renderStatic({ name: line.speakerName || ch?.name || '', nameColor: ch?.color, portraitUrl: pa ? session.assets.url(pa) : null, text: interpolateVarsCompat(line.text, project, varsRef.current!) }, null, true);
  }, [lines, ui.selectedLine, ui.showTextbox, scene.hideTextbox, project.settings.textbox, project.characters]);

  /* --------------------------------------------------------------- */
  /* View: pan / zoom                                                 */
  /* --------------------------------------------------------------- */

  const setView = (zoom: number, x: number, y: number) => {
    stageRef.current?.setView(zoom, x, y);
    session.setSceneUI(nodeId, { view: { zoom, x, y } });
  };

  useEffect(() => {
    const el = hostRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = stageRef.current;
      if (!st) return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5 && e.deltaMode === 0 && Math.abs(e.deltaX) > 0) {
        setView(st.scale, st.offsetX - e.deltaX, st.offsetY - e.deltaY);
        return;
      }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const zoom = Math.max(0.05, Math.min(8, st.scale * factor));
      setView(zoom, mx - ((mx - st.offsetX) / st.scale) * zoom, my - ((my - st.offsetY) / st.scale) * zoom);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) setSpaceDown(true); };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { el.removeEventListener('wheel', wheel); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [nodeId]);

  const fit = () => {
    const st = stageRef.current;
    if (!st) return;
    const f = st.fitScale();
    setView(f.scale * 0.92, f.offsetX + st.width * f.scale * 0.04, f.offsetY + st.height * f.scale * 0.04);
  };

  /* --------------------------------------------------------------- */
  /* Selection and transforms                                         */
  /* --------------------------------------------------------------- */

  const selected = ui.selectedLayers.filter((id) => scene.layers.some((l) => l.id === id));
  const selectable = (l: Layer) => !l.locked && l.visible && ownIds.has(l.id);

  const startPan = (e: React.PointerEvent) => {
    const st = stageRef.current!;
    const sx = e.clientX, sy = e.clientY, ox = st.offsetX, oy = st.offsetY;
    document.body.classList.add('panning');
    const move = (ev: PointerEvent) => { st.setView(st.scale, ox + ev.clientX - sx, oy + ev.clientY - sy); force((x) => x + 1); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('panning'); session.setSceneUI(nodeId, { view: { zoom: st.scale, x: st.offsetX, y: st.offsetY } }); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Stage-space movement → the element's own x/y space (its group and its linked parent). */
  const parentInverse = (view: ReturnType<typeof buildView>, l: Layer) => {
    if (!l.parentId && !l.link) return null;
    const pm = parentSpace(view, l);
    return invert([pm[0], pm[1], pm[2], pm[3], 0, 0]);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const st = stageRef.current;
    if (!st) return;
    hostRef.current?.focus();
    if (e.button === 1 || e.button === 2 || spaceDown || (e.button === 0 && e.altKey && !(e.target as HTMLElement).closest('.gizmo-handle'))) {
      if (e.button === 2) return;
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest('.gizmo-handle') as HTMLElement | null;
    const view = buildView();
    const p = st.toStage(e.clientX, e.clientY);
    let ids = selected;
    if (!handle) {
      const hit = hitTest(view, p.x, p.y, selectable);
      // Empty space: deselect and pan (like every canvas in the editor).
      if (!hit) { session.setSceneUI(nodeId, { selectedLayers: [] }); e.preventDefault(); startPan(e); return; }
      if (e.shiftKey || e.metaKey || e.ctrlKey) ids = selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : [...selected, hit.id];
      else ids = selected.includes(hit.id) ? selected : [hit.id];
      session.setSceneUI(nodeId, { selectedLayers: ids });
      if (!ids.includes(hit.id)) return;
    }
    const mode = handle?.dataset.mode || 'move';
    if (mode === 'point') { dragRegionPoint(e, Number(handle!.dataset.index)); return; }
    const layers = ids.map((id) => scene.layers.find((l) => l.id === id)!).filter((l) => l && !l.locked);
    if (!layers.length) return;
    const starts = layers.map((l) => ({ l, props: { ...view.props(l) } }));
    const primary = starts[0];
    const pm = worldMatrix(view, primary.l.id);
    const size = layerSize(view, primary.l, primary.props);
    const anchorWorld = apply(pm, (primary.props.anchorX ?? 0.5) * size.width, (primary.props.anchorY ?? 0.5) * size.height);
    const mergeKey = `xf-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const q = st.toStage(ev.clientX, ev.clientY);
      const dx = q.x - p.x, dy = q.y - p.y;
      if (!moved && Math.hypot(dx, dy) * st.scale < 3) return;
      moved = true;
      if (mode === 'move') {
        let sdx = dx, sdy = dy;
        const g: Guide[] = [];
        if (ui.snap && !ev.altKey) {
          const corners = layerCorners(view, primary.l).map((c) => ({ x: c.x + dx, y: c.y + dy }));
          const xs = [Math.min(...corners.map((c) => c.x)), (Math.min(...corners.map((c) => c.x)) + Math.max(...corners.map((c) => c.x))) / 2, Math.max(...corners.map((c) => c.x))];
          const ys = [Math.min(...corners.map((c) => c.y)), (Math.min(...corners.map((c) => c.y)) + Math.max(...corners.map((c) => c.y))) / 2, Math.max(...corners.map((c) => c.y))];
          const tx = [0, W / 2, W], ty = [0, H / 2, H];
          for (const o of scene.layers) {
            if (ids.includes(o.id) || !o.visible || session.engine.layerTypes.get(o.type)?.visual === false || o.type === 'core.group' || o.type === 'core.background') continue;
            const oc = layerCorners(view, o);
            const ox = oc.map((c) => c.x), oy = oc.map((c) => c.y);
            tx.push(Math.min(...ox), (Math.min(...ox) + Math.max(...ox)) / 2, Math.max(...ox));
            ty.push(Math.min(...oy), (Math.min(...oy) + Math.max(...oy)) / 2, Math.max(...oy));
          }
          const th = 6 / st.scale;
          let best = th, bx: number | null = null;
          for (const a of xs) for (const b of tx) if (Math.abs(a - b) < best) { best = Math.abs(a - b); bx = b - a; g[0] = { x: b }; }
          best = th;
          let by: number | null = null;
          for (const a of ys) for (const b of ty) if (Math.abs(a - b) < best) { best = Math.abs(a - b); by = b - a; g[1] = { y: b }; }
          if (bx !== null) sdx += bx;
          if (by !== null) sdy += by;
        }
        setGuides(g.filter(Boolean));
        for (const s of starts) {
          const inv = parentInverse(view, s.l);
          const d = inv ? apply(inv, sdx, sdy) : { x: sdx, y: sdy };
          let nx = (s.props.x ?? 0) + d.x, ny = (s.props.y ?? 0) + d.y;
          if (ev.shiftKey) { if (Math.abs(sdx) > Math.abs(sdy)) ny = s.props.y; else nx = s.props.x; }
          setLayerProps(session, nodeId, s.l.id, { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 }, { mergeKey, label: t('layer.move') });
        }
      } else if (mode === 'rotate') {
        const a0 = Math.atan2(p.y - anchorWorld.y, p.x - anchorWorld.x);
        const a1 = Math.atan2(q.y - anchorWorld.y, q.x - anchorWorld.x);
        let r = (primary.props.rotation ?? 0) + ((a1 - a0) * 180) / Math.PI;
        if (ev.shiftKey) r = Math.round(r / 15) * 15;
        setLayerProps(session, nodeId, primary.l.id, { rotation: Math.round(r * 10) / 10 }, { mergeKey, label: t('layer.rotate') });
      } else if (mode.startsWith('scale')) {
        const inv = invert(pm);
        if (!inv) return;
        const lp0 = apply(inv, p.x, p.y), lp1 = apply(inv, q.x, q.y);
        const ax = (primary.props.anchorX ?? 0.5) * size.width, ay = (primary.props.anchorY ?? 0.5) * size.height;
        const fx = Math.abs(lp0.x - ax) > 1 ? (lp1.x - ax) / (lp0.x - ax) : 1;
        const fy = Math.abs(lp0.y - ay) > 1 ? (lp1.y - ay) / (lp0.y - ay) : 1;
        let sx = (primary.props.scaleX ?? 1) * fx, sy = (primary.props.scaleY ?? 1) * fy;
        if (mode === 'scale-x') sy = primary.props.scaleY ?? 1;
        if (mode === 'scale-y') sx = primary.props.scaleX ?? 1;
        if (ev.shiftKey && mode === 'scale') { const f = Math.abs(fx) > Math.abs(fy) ? fx : fy; sx = (primary.props.scaleX ?? 1) * f; sy = (primary.props.scaleY ?? 1) * f; }
        setLayerProps(session, nodeId, primary.l.id, { scaleX: Math.round(sx * 1000) / 1000, scaleY: Math.round(sy * 1000) / 1000 }, { mergeKey, label: t('layer.scale') });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    const view = buildView();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && selected.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      for (const id of selected) { const l = scene.layers.find((x) => x.id === id)!; if (l.locked) continue; const p = view.props(l); setLayerProps(session, nodeId, id, { x: (p.x ?? 0) + dx, y: (p.y ?? 0) + dy }, { mergeKey: 'nudge', label: t('layer.move') }); }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) { e.preventDefault(); deleteLayers(session, nodeId, selected); }
    else if (mod && e.key.toLowerCase() === 'd' && selected.length) { e.preventDefault(); duplicateLayers(session, nodeId, selected); }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); session.setSceneUI(nodeId, { selectedLayers: scene.layers.filter(selectable).map((l) => l.id) }); }
    else if (e.key === 'Escape') session.setSceneUI(nodeId, { selectedLayers: [] });
    else if (e.key === '0' && mod) { e.preventDefault(); fit(); }
  };

  /* Polygon detection areas: drag a corner, double-click an edge to add one, double-click a corner to remove it. */
  const regionLayer = () => { const l = scene.layers.find((x) => x.id === selected[0]); return l && l.type === 'core.hotspot' ? l : null; };
  const toLocalUnit = (layerId: string, clientX: number, clientY: number) => {
    const st = stageRef.current!;
    const view = buildView();
    const l = scene.layers.find((x) => x.id === layerId)!;
    const inv = invert(worldMatrix(view, layerId));
    const s = layerSize(view, l, view.props(l));
    const q = st.toStage(clientX, clientY);
    const lp = inv ? apply(inv, q.x, q.y) : q;
    return [Math.round(Math.max(0, Math.min(1, lp.x / (s.width || 1))) * 1000) / 1000, Math.round(Math.max(0, Math.min(1, lp.y / (s.height || 1))) * 1000) / 1000] as [number, number];
  };
  const pointsOf = (l: Layer): [number, number][] => (Array.isArray(l.props.points) ? l.props.points.map((p: any) => [Number(p[0]) || 0, Number(p[1]) || 0]) : []);
  const dragRegionPoint = (e: React.PointerEvent, index: number) => {
    const l = regionLayer();
    if (!l) return;
    e.preventDefault();
    e.stopPropagation();
    const mergeKey = `pt-${Date.now()}`;
    const base = pointsOf(l);
    const move = (ev: PointerEvent) => {
      const pts = base.map((p) => [...p] as [number, number]);
      pts[index] = toLocalUnit(l.id, ev.clientX, ev.clientY);
      setLayerProps(session, nodeId, l.id, { points: pts }, { mergeKey, label: t('region.editPoints') });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const insertRegionPoint = (layerId: string, e: React.MouseEvent) => {
    const l = scene.layers.find((x) => x.id === layerId);
    if (!l) return;
    e.stopPropagation();
    const p = toLocalUnit(layerId, e.clientX, e.clientY);
    const pts = pointsOf(l);
    // Insert after the corner whose edge is nearest to the click.
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(a[0] + u * vx - p[0], a[1] + u * vy - p[1]);
      if (d < bd) { bd = d; best = i; }
    }
    pts.splice(best + 1, 0, p);
    setLayerProps(session, nodeId, layerId, { points: pts }, { label: t('region.addPoint') });
  };
  const removeRegionPoint = (layerId: string, index: number) => {
    const l = scene.layers.find((x) => x.id === layerId);
    if (!l) return;
    const pts = pointsOf(l);
    if (pts.length <= 3) { store.toast(t('region.minPoints')); return; }
    pts.splice(index, 1);
    setLayerProps(session, nodeId, layerId, { points: pts }, { label: t('region.removePoint') });
  };

  // Cmd/Ctrl+C, X and V arrive as copy / cut / paste events (also from the desktop Edit menu).
  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if ((e.target as HTMLElement).closest('input, textarea, select') || !selected.length) return;
    const data = scene.layers.filter((l) => selected.includes(l.id));
    store.clipboard = { kind: 'layers', data };
    const json = JSON.stringify({ kind: 'vne.layers', layers: data });
    e.clipboardData.setData('text/plain', json);
    e.clipboardData.setData('application/x-vne-layers', json);
    e.preventDefault();
    if (cut) deleteLayers(session, nodeId, selected);
    else store.toast(t('layer.copied', { n: data.length }));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    let layers: Layer[] | null = null;
    const text = e.clipboardData.getData('application/x-vne-layers') || e.clipboardData.getData('text/plain');
    try { const v = JSON.parse(text); if (v?.kind === 'vne.layers' && Array.isArray(v.layers)) layers = v.layers; } catch { /* not ours */ }
    if (!layers && store.clipboard?.kind === 'layers') layers = store.clipboard.data;
    if (!layers?.length) return;
    e.preventDefault();
    pasteLayers(session, nodeId, layers);
  };

  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-vne-asset');
    const st = stageRef.current;
    if (!id || !st) return;
    e.preventDefault();
    const a = project.assets.find((x) => x.id === id);
    if (!a) return;
    const p = st.toStage(e.clientX, e.clientY);
    const hasBg = scene.layers.some((l) => l.type === 'core.background');
    if (a.kind === 'image') {
      const big = (a.meta.width || 0) >= W * 0.8 && (a.meta.height || 0) >= H * 0.8;
      if (big && !hasBg) addLayer(session, nodeId, 'core.background', { assetId: a.id, x: W / 2, y: H / 2 }, a.name.replace(/\.[^.]+$/, ''));
      else addLayer(session, nodeId, 'core.image', { assetId: a.id, x: Math.round(p.x), y: Math.round(p.y) }, a.name.replace(/\.[^.]+$/, ''));
    } else if (a.kind === 'video') addLayer(session, nodeId, 'core.video', { assetId: a.id, x: Math.round(p.x), y: Math.round(p.y) }, a.name.replace(/\.[^.]+$/, ''));
    else if (a.kind === 'audio') addLayer(session, nodeId, 'core.audio', { assetId: a.id }, a.name.replace(/\.[^.]+$/, ''));
  };

  // Gizmos (screen space)
  const st = stageRef.current;
  const view = st ? buildView() : null;
  const toScreen = (q: { x: number; y: number }) => ({ x: (st?.offsetX || 0) + q.x * (st?.scale || 1), y: (st?.offsetY || 0) + q.y * (st?.scale || 1) });
  const gizmos = view ? selected.map((id) => {
    const l = scene.layers.find((x) => x.id === id);
    if (!l || session.engine.layerTypes.get(l.type)?.visual === false) return null;
    const c = layerCorners(view, l).map(toScreen);
    const props = view.props(l);
    const size = layerSize(view, l, props);
    const m = worldMatrix(view, l.id);
    const anchor = toScreen(apply(m, (props.anchorX ?? 0.5) * size.width, (props.anchorY ?? 0.5) * size.height));
    const topMid = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
    const center = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
    const dir = { x: topMid.x - center.x, y: topMid.y - center.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const rot = { x: topMid.x + (dir.x / len) * 28, y: topMid.y + (dir.y / len) * 28 };
    const mid = (a: any, b: any) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    // Polygon detection areas: their corners are edited on the canvas.
    const pts = l.type === 'core.hotspot' && props.shape === 'polygon' && selected.length === 1 && !l.locked
      ? regionPoints(props, size.width, size.height).map(([x, y]) => toScreen(apply(m, x, y))) : null;
    return { l, c, anchor, topMid, rot, sides: [mid(c[1], c[2]), mid(c[3], c[0]), mid(c[2], c[3])], pts };
  }).filter(Boolean) as any[] : [];
  const frame = st ? { x: st.offsetX, y: st.offsetY, w: W * st.scale, h: H * st.scale } : null;

  // Motion path (After Effects-style): where the selected element's position travels in the
  // current animation, with a handle per position keyframe that can be dragged on the stage.
  const motion = (() => {
    if (!view || selected.length !== 1) return null;
    const l = scene.layers.find((x) => x.id === selected[0]);
    const clip = ui.clipId ? scene.animations.find((a) => a.id === ui.clipId) : null;
    if (!l || !clip || l.locked) return null;
    const tx = clip.tracks.find((tr) => tr.layerId === l.id && tr.prop === 'x' && tr.keyframes.length);
    const ty = clip.tracks.find((tr) => tr.layerId === l.id && tr.prop === 'y' && tr.keyframes.length);
    if (!tx && !ty) return null;
    const ps = parentSpace(view, l);
    const at = (time: number) => {
      const x = tx ? Number(sampleTrack(session.engine, tx, time, 'number')) : Number(l.props.x ?? 0);
      const y = ty ? Number(sampleTrack(session.engine, ty, time, 'number')) : Number(l.props.y ?? 0);
      return toScreen(apply(ps, x, y));
    };
    const endT = clipEnd(clip);
    const pts: string[] = [];
    for (let time = 0; time <= endT + 1e-9; time += Math.max(1 / 60, endT / 400)) { const p = at(time); pts.push(`${p.x},${p.y}`); }
    const times = [...new Set([...(tx?.keyframes || []), ...(ty?.keyframes || [])].map((k) => k.t))].sort((a, b) => a - b);
    return { l, clip, ps, pts: pts.join(' '), keys: times.map((time) => ({ time, p: at(time) })) };
  })();

  /** Drag a motion path key: writes x and y keys at that time (adding the missing one). */
  const dragMotionKey = (e: React.PointerEvent, time: number) => {
    if (!motion || !stageRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    session.setSceneUI(nodeId, { time });
    const inv = invert(motion.ps);
    if (!inv) return;
    const stg = stageRef.current;
    const mk = `mpath-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const q = apply(inv, stg.toStage(ev.clientX, ev.clientY).x, stg.toStage(ev.clientX, ev.clientY).y);
      updateScene(session, nodeId, t('timeline.moveOnPath'), (s) => {
        const c = s.animations.find((a) => a.id === motion.clip.id);
        if (!c) return;
        for (const [prop, v] of [['x', q.x], ['y', q.y]] as const) {
          let tr = c.tracks.find((x) => x.layerId === motion.l.id && x.prop === prop);
          if (!tr) { tr = { id: newId('trk'), layerId: motion.l.id, prop, keyframes: [] }; c.tracks.push(tr); }
          const k = tr.keyframes.find((x) => Math.abs(x.t - time) < 1e-3);
          if (k) k.v = Math.round(v * 10) / 10;
          else { tr.keyframes.push({ id: newId('key'), t: time, v: Math.round(v * 10) / 10, ease: 'easeInOut' }); normalizeTrack(tr); }
        }
      }, mk);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="comp-wrap">
      <div ref={hostRef} className={cx('comp-canvas', spaceDown && 'pan-ready')} tabIndex={0} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={onPaste}
        onContextMenu={(e) => {
          e.preventDefault();
          const stg = stageRef.current;
          if (!stg) return;
          const vv = buildView();
          const p = stg.toStage(e.clientX, e.clientY);
          const hit = hitTest(vv, p.x, p.y, selectable);
          if (hit && !selected.includes(hit.id)) session.setSceneUI(nodeId, { selectedLayers: [hit.id] });
          const ids = hit ? (selected.includes(hit.id) ? selected : [hit.id]) : [];
          openMenu(e, ids.length ? [
            { label: t('common.duplicate'), icon: 'duplicate', onClick: () => duplicateLayers(session, nodeId, ids) },
            { label: t('layer.bringFront'), icon: 'arrowUp', onClick: () => reorder(session, nodeId, ids, 'front') },
            { label: t('layer.sendBack'), icon: 'arrowDown', onClick: () => reorder(session, nodeId, ids, 'back') },
            { label: t('layer.addEffect'), icon: 'sparkles', onClick: () => session.setSceneUI(nodeId, { bottomTab: 'effects', selectedLayers: [ids[0]] }) },
            { label: t('layer.addScript'), icon: 'script', onClick: () => session.setSceneUI(nodeId, { bottomTab: 'behaviors', selectedLayers: [ids[0]] }) },
            { separator: true },
            { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteLayers(session, nodeId, ids) },
          ] : addLayerMenu(session, nodeId, t, { x: Math.round(p.x), y: Math.round(p.y) }));
        }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-vne-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={onDrop}
        aria-label={t('scene.canvas')}>
        <svg className="gizmos" width="100%" height="100%">
          {frame && <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} className="stage-frame" />}
          {frame && ui.snap && <>
            <line x1={frame.x + frame.w / 2} y1={frame.y} x2={frame.x + frame.w / 2} y2={frame.y + frame.h} className="center-guide" />
            <line x1={frame.x} y1={frame.y + frame.h / 2} x2={frame.x + frame.w} y2={frame.y + frame.h / 2} className="center-guide" />
          </>}
          {guides.map((g, i) => g.x !== undefined
            ? <line key={i} x1={toScreen({ x: g.x, y: 0 }).x} y1={0} x2={toScreen({ x: g.x, y: 0 }).x} y2="100%" className="snap-guide" />
            : <line key={i} x1={0} y1={toScreen({ x: 0, y: g.y! }).y} x2="100%" y2={toScreen({ x: 0, y: g.y! }).y} className="snap-guide" />)}
          {motion && (
            <g className="motion-path">
              <polyline points={motion.pts} />
              {motion.keys.map((k) => <rect key={k.time} x={k.p.x - 4} y={k.p.y - 4} width={8} height={8} className={cx('motion-key', Math.abs(k.time - ui.time) < 1e-3 && 'current')}
                transform={`rotate(45 ${k.p.x} ${k.p.y})`} onPointerDown={(e) => dragMotionKey(e, k.time)}><title>{`${k.time.toFixed(2)} s`}</title></rect>)}
            </g>
          )}
          {gizmos.map((g: any) => (
            <g key={g.l.id} className="gizmo">
              <polygon points={g.c.map((p: any) => `${p.x},${p.y}`).join(' ')} className="gizmo-box" />
              <line x1={g.topMid.x} y1={g.topMid.y} x2={g.rot.x} y2={g.rot.y} className="gizmo-stem" />
              <circle cx={g.rot.x} cy={g.rot.y} r={6} className="gizmo-handle rotate" data-mode="rotate" />
              {g.c.map((p: any, i: number) => <rect key={i} x={p.x - 5} y={p.y - 5} width={10} height={10} className="gizmo-handle" data-mode="scale" />)}
              <rect x={g.sides[0].x - 4} y={g.sides[0].y - 4} width={8} height={8} className="gizmo-handle side" data-mode="scale-x" />
              <rect x={g.sides[1].x - 4} y={g.sides[1].y - 4} width={8} height={8} className="gizmo-handle side" data-mode="scale-x" />
              <rect x={g.sides[2].x - 4} y={g.sides[2].y - 4} width={8} height={8} className="gizmo-handle side" data-mode="scale-y" />
              <circle cx={g.anchor.x} cy={g.anchor.y} r={4} className="gizmo-anchor" />
              {g.pts && <>
                <polygon points={g.pts.map((p: any) => `${p.x},${p.y}`).join(' ')} className="gizmo-region" onDoubleClick={(e) => insertRegionPoint(g.l.id, e)} />
                {g.pts.map((p: any, i: number) => <circle key={`p${i}`} cx={p.x} cy={p.y} r={5.5} className="gizmo-handle point" data-mode="point" data-index={i}
                  onDoubleClick={(e) => { e.stopPropagation(); removeRegionPoint(g.l.id, i); }} />)}
              </>}
              {g.l.locked && <text x={g.c[0].x + 4} y={g.c[0].y - 6} className="gizmo-label">🔒</text>}
            </g>
          ))}
        </svg>
      </div>
      <div className="comp-toolbar">
        <button type="button" className="btn btn-sm" onClick={(e) => openMenu(e, addLayerMenu(session, nodeId, t, { x: W / 2, y: H / 2 }))}><Icon name="plus" size={14} /><span>{t('layer.add')}</span></button>
        <span className="sep" />
        <IconButton icon="magnet" size={15} title={t('scene.snap')} active={ui.snap} onClick={() => session.setSceneUI(nodeId, { snap: !ui.snap })} />
        <IconButton icon="message" size={15} title={t('scene.textboxPreview')} active={ui.showTextbox} onClick={() => session.setSceneUI(nodeId, { showTextbox: !ui.showTextbox })} />
        <IconButton icon="globe" size={15} title={t('scene.showContext')} active={session.ui.showContext !== false} onClick={() => session.setUI({ showContext: session.ui.showContext === false })} />
        <span className="sep" />
        <IconButton icon="minus" size={15} title={t('graph.zoomOut')} onClick={() => { const s = stageRef.current!; const r = hostRef.current!.getBoundingClientRect(); const z = s.scale / 1.25; setView(z, r.width / 2 - ((r.width / 2 - s.offsetX) / s.scale) * z, r.height / 2 - ((r.height / 2 - s.offsetY) / s.scale) * z); }} />
        <span className="zoom-label">{Math.round((st?.scale || 1) * 100)}%</span>
        <IconButton icon="plus" size={15} title={t('graph.zoomIn')} onClick={() => { const s = stageRef.current!; const r = hostRef.current!.getBoundingClientRect(); const z = s.scale * 1.25; setView(z, r.width / 2 - ((r.width / 2 - s.offsetX) / s.scale) * z, r.height / 2 - ((r.height / 2 - s.offsetY) / s.scale) * z); }} />
        <IconButton icon="fit" size={15} title={`${t('scene.fit')} (${'Mod+0'.replace('Mod', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')})`} onClick={fit} />
        <span className="res-label">{W}×{H}</span>
      </div>
    </div>
  );
}

/**
 * The "Add element" menu (Layers panel, canvas and Interactions): media (from the
 * library or a new file), shapes, text, choice, button, detection areas, then the rest.
 * `fromScripts`: elements made in Interactions start hidden and do not autoplay, so
 * scripts decide when they appear (the "Start" block shows and plays them).
 */
export function addLayerMenu(session: ProjectSession, nodeId: string, t: (k: string, p?: any) => string, at: { x: number; y: number }, opts: { fromScripts?: boolean; nested?: boolean } = {}): any[] {
  const defs = session.engine.layerTypes.list();
  const isGlobal = nodeId === GLOBAL_NODE_ID;
  if (isGlobal && !session.project.nodes[GLOBAL_NODE_ID]) session.update(t('global.title'), (d) => { ensureGlobalNode(d); });
  const has = (id: string) => !!session.engine.layerTypes.get(id);
  const pos = { x: Math.round(at.x), y: Math.round(at.y) };
  const hidden = opts.fromScripts ? { visible: false } : undefined;
  const add = (type: string, extra: Record<string, any> = {}, name?: string, f?: { visible?: boolean }) => {
    const id = addLayer(session, nodeId, type, extra, name, f);
    if (isGlobal && opts.nested) store.toast(t('global.added'), 'success', { label: t('global.open'), run: () => openGlobalPage(session, id || undefined) });
    return id;
  };
  const nameOf = (a: { name: string }) => a.name.replace(/\.[^.]+$/, '');
  const fromAsset = (a: any) => {
    if (a.kind === 'image') return add('core.image', { assetId: a.id, ...pos }, nameOf(a), hidden);
    if (a.kind === 'video') return add('core.video', { assetId: a.id, ...pos, ...(opts.fromScripts ? { autoplay: false } : {}) }, nameOf(a), hidden);
    if (a.kind === 'audio') return add('core.audio', { assetId: a.id, ...(opts.fromScripts ? { autoplay: false } : {}) }, nameOf(a));
    return null;
  };
  const assetItems = (kind: 'image' | 'video' | 'audio', type: string) => {
    const list = session.project.assets.filter((a) => a.kind === kind);
    return [
      ...list.map((a) => ({ label: nameOf(a), icon: kind === 'image' ? 'image' : kind === 'video' ? 'film' : 'music', onClick: () => fromAsset(a) })),
      ...(list.length ? [{ separator: true }] : []),
      { label: t('element.importFile'), icon: 'upload', onClick: () => importAndAdd(session, kind, fromAsset) },
      { label: t('element.empty', { kind: t(`layer.${kind === 'image' ? 'image' : kind}`) }), icon: 'plus', onClick: () => add(type, type === 'core.audio' ? {} : pos, undefined, type === 'core.audio' ? undefined : hidden) },
    ];
  };
  const shapeOpts: { value: string; label: string }[] = (session.engine.layerTypes.get('core.shape')?.props.find((p) => p.key === 'shape')?.options as any) || [];
  const regionOpts: { value: string; label: string }[] = (session.engine.layerTypes.get('core.hotspot')?.props.find((p) => p.key === 'shape')?.options as any) || [];
  const items: any[] = [
    { header: true, label: t('element.group.media') },
    { label: t('layer.image'), icon: 'image', submenu: assetItems('image', 'core.image') },
    { label: t('layer.video'), icon: 'film', submenu: assetItems('video', 'core.video') },
    { label: t('layer.audio'), icon: 'music', submenu: assetItems('audio', 'core.audio') },
    ...(has('core.character') ? [{ label: t('layer.character'), icon: 'user', onClick: () => add('core.character', pos, undefined, hidden) }] : []),
    ...(!opts.fromScripts && has('core.background') ? [{ label: t('layer.background'), icon: 'image', onClick: () => add('core.background', {}) }] : []),
    { header: true, label: t('element.group.shapes') },
    ...shapeOpts.map((o) => ({ label: t(o.label), icon: 'square', onClick: () => add('core.shape', { ...pos, shape: o.value }, t(o.label), hidden) })),
    { header: true, label: t('element.group.text') },
    { label: t('layer.text'), icon: 'type', onClick: () => add('core.text', pos, undefined, hidden) },
    ...(has('core.freeDialogue') ? [{ label: t('layer.freeDialogue'), icon: 'quote', hint: t('layer.freeDialogue.hint'), onClick: () => add('core.freeDialogue', { ...pos, speaker: session.project.characters[0]?.name || t('layer.freeDialogue.speaker'), text: t('layer.freeDialogue.sample') }, undefined, hidden) }] : []),
    ...(has('core.dialogue') && !isGlobal ? [{ label: t('layer.dialogue'), icon: 'message', onClick: () => add('core.dialogue', {}) }] : []),
    { header: true, label: t('element.group.interactive') },
    ...(isGlobal ? [] : [{ label: t('layer.choice'), icon: 'choice', onClick: () => add('core.choice', {}) }]),
    { label: t('layer.button'), icon: 'button', onClick: () => add('core.button', pos, undefined, hidden) },
    { label: t('layer.hotspot'), icon: 'target', submenu: regionOpts.map((o) => ({ label: t(o.label), onClick: () => add('core.hotspot', { ...pos, shape: o.value }, `${t('layer.hotspot')}`) })) },
    { header: true, label: t('element.group.game') },
    ...(has('core.sprite') ? [{ label: t('layer.sprite'), icon: 'sprite', hint: t('layer.sprite.hint'), onClick: () => add('core.sprite', pos, undefined, hidden) }] : []),
    ...(has('core.inventory') ? [{ label: t('layer.inventory'), icon: 'backpack', hint: t('layer.inventory.hint'), onClick: () => { ensureInventory(session); add('core.inventory', { x: 40, y: 40, anchorX: 0, anchorY: 0 }); } }] : []),
  ];
  if (!isGlobal && !opts.nested) {
    // Global elements are on every page (music, HUD, inventory, health bar…).
    items.push({ header: true, label: t('element.group.global') }, { label: t('element.addGlobal'), icon: 'globe', hint: t('element.addGlobalHint'), submenu: addLayerMenu(session, GLOBAL_NODE_ID, t, at, { ...opts, nested: true }) });
  }
  const shown = new Set(['core.image', 'core.video', 'core.audio', 'core.character', 'core.background', 'core.shape', 'core.text', 'core.dialogue', 'core.choice', 'core.button', 'core.hotspot', 'core.composition', 'core.sprite', 'core.inventory', 'core.freeDialogue']);
  const rest = defs.filter((d) => !shown.has(d.id));
  const cats = ['effect', 'structure', 'module'];
  for (const c of cats) {
    const list = rest.filter((d) => (d.owner && d.owner !== 'core' ? 'module' : d.category === 'effect' || d.category === 'structure' ? d.category : 'module') === c);
    if (!list.length) continue;
    items.push({ header: true, label: t(`layercat.${c}`) });
    for (const d of list) items.push({ label: t(d.label), icon: d.icon || 'layers', onClick: () => add(d.id, d.visual && d.id !== 'core.particles' && d.id !== 'core.group' ? pos : {}, undefined, d.visual ? hidden : undefined) });
  }
  if (session.project.compositions.length) {
    items.push({ header: true, label: t('layer.compositions') });
    for (const c of session.project.compositions) items.push({ label: c.name, icon: 'layers', onClick: () => add('core.composition', { compositionId: c.id, ...pos }, c.name, hidden) });
  }
  return items;
}

/** Inventories show the inventory list: make sure it exists. */
export function ensureInventory(session: ProjectSession): void {
  if (session.project.inventoryVarId && session.project.variables.some((v) => v.id === session.project.inventoryVarId)) return;
  session.update(session.i18n.t('items.inventoryCreated'), (d) => { ensureInventoryVar(d, session.i18n.t('items.inventoryName')); });
}

/** Import media files into the library and add each as an element. */
async function importAndAdd(session: ProjectSession, kind: 'image' | 'video' | 'audio', addOne: (a: any) => any): Promise<void> {
  const ext = kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'] : kind === 'video' ? ['mp4', 'webm', 'mov', 'm4v'] : ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'opus'];
  const paths = await store.pickFiles(session.i18n.t('element.importFile'), [{ name: session.i18n.t(`layer.${kind}`), extensions: ext }]);
  if (!paths?.length) return;
  const assets = await importFiles(session, paths);
  for (const a of assets.filter((x) => x.kind === kind)) addOne(a);
}

export function reorder(session: ProjectSession, nodeId: string, ids: string[], where: 'front' | 'back' | 'up' | 'down'): void {
  const t = session.i18n.t;
  session.update(t('layer.reorder'), (d) => {
    const s = d.nodes[nodeId].data as SceneData;
    const moving = s.layers.filter((l) => ids.includes(l.id));
    const rest = s.layers.filter((l) => !ids.includes(l.id));
    if (where === 'front') s.layers = [...rest, ...moving];
    else if (where === 'back') {
      const bgCount = rest.filter((l) => l.type === 'core.background').length && !moving.some((m) => m.type === 'core.background') ? rest.findIndex((l) => l.type !== 'core.background') : 0;
      s.layers = [...rest.slice(0, Math.max(0, bgCount)), ...moving, ...rest.slice(Math.max(0, bgCount))];
    } else {
      const arr = [...s.layers];
      const order = where === 'up' ? [...ids].reverse() : ids;
      for (const id of order) {
        const i = arr.findIndex((l) => l.id === id);
        const j = where === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= arr.length) continue;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      s.layers = arr;
    }
  });
}

export function pasteLayers(session: ProjectSession, nodeId: string, layers: Layer[]): void {
  const t = session.i18n.t;
  const created: string[] = [];
  // updateScene keeps the node's outputs in step with pasted choice elements.
  updateScene(session, nodeId, t('common.paste'), (s) => {
    const ids = new Set(s.layers.map((l) => l.id));
    const map = new Map<string, string>();
    for (const l of layers) map.set(l.id, `lyr_${Math.random().toString(36).slice(2, 14)}`);
    for (const l of layers) {
      const c: Layer = JSON.parse(JSON.stringify(l));
      c.id = map.get(l.id)!;
      c.parentId = l.parentId && map.has(l.parentId) ? map.get(l.parentId)! : l.parentId && ids.has(l.parentId) ? l.parentId : null;
      if (typeof c.props.x === 'number') { c.props.x += 24; c.props.y += 24; }
      s.layers.push(c);
      created.push(c.id);
    }
  });
  session.setSceneUI(nodeId, { selectedLayers: created });
}

export { layerMatrix };

/** Effect nodes whose output depends on time or on live values (redraw continuously in the editor). */
const TIME_NODES = new Set(['fx.time', 'fx.oscillator', 'fx.smoothNoise', 'fx.noise', 'fx.wave', 'fx.ripple', 'fx.shader', 'fx.variable', 'fx.layerProp']);

/** True when a layer changes without keyframes: time-based effect graphs or module properties that use time. */
function layerMovesOverTime(engine: Engine, project: Project, l: Layer): boolean {
  const eff = l.effect;
  if (eff) {
    const graph = eff.kind === 'inline' ? eff.graph : project.effectGraphs.find((g) => g.id === eff.graphId);
    if (graph?.nodes.some((n) => TIME_NODES.has(n.type) || engine.effectNodes.get(n.type)?.animated || !engine.effectNodes.get(n.type))) return true;
  }
  // Properties added by modules may animate with the clock (e.g. "Float"); redraw while they are set.
  for (const ext of engine.properties.list()) if (l.props[ext.prop.key]) return true;
  return false;
}
