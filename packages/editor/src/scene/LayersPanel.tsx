import { useState } from 'react';
import type { SceneData, Layer } from '@vne/core';
import { newId, createLayer, remapIds } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { layerTree, deleteLayers, duplicateLayers, updateScene, sceneOf } from './sceneOps';
import { addLayerMenu, reorder } from './CompositionCanvas';
import { IconButton, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu } from '../ui/Menu';

export function LayersPanel({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const scene = sceneOf(session, nodeId)!;
  const ui = session.sceneUI(nodeId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'above' | 'below' | 'into' } | null>(null);
  const rows = layerTree(scene);
  const sel = new Set(ui.selectedLayers);

  const select = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && ui.selectedLayers.length) {
      const ids = rows.map((r) => r.layer.id);
      const a = ids.indexOf(ui.selectedLayers[0]), b = ids.indexOf(id);
      session.setSceneUI(nodeId, { selectedLayers: ids.slice(Math.min(a, b), Math.max(a, b) + 1) });
    } else if (e.metaKey || e.ctrlKey) session.setSceneUI(nodeId, { selectedLayers: sel.has(id) ? ui.selectedLayers.filter((x) => x !== id) : [...ui.selectedLayers, id] });
    else session.setSceneUI(nodeId, { selectedLayers: [id] });
  };

  const toggle = (id: string, key: 'visible' | 'locked') => updateScene(session, nodeId, key === 'visible' ? t('layer.toggleVisible') : t('layer.toggleLock'), (s) => { const l = s.layers.find((x) => x.id === id); if (l) l[key] = !l[key]; });

  const group = () => {
    const ids = ui.selectedLayers;
    if (!ids.length) return;
    const g = createLayer(session.engine, session.project, 'core.group', t('layer.group'));
    updateScene(session, nodeId, t('layer.groupSelection'), (s) => {
      const first = s.layers.findIndex((l) => ids.includes(l.id));
      const parent = s.layers[first]?.parentId ?? null;
      g.parentId = parent;
      s.layers.splice(Math.max(0, first), 0, g);
      for (const l of s.layers) if (ids.includes(l.id)) l.parentId = g.id;
    });
    session.setSceneUI(nodeId, { selectedLayers: [g.id] });
  };

  const ungroup = (id: string) => updateScene(session, nodeId, t('layer.ungroup'), (s) => {
    const g = s.layers.find((l) => l.id === id);
    if (!g) return;
    for (const l of s.layers) if (l.parentId === id) {
      l.parentId = g.parentId;
      if (typeof l.props.x === 'number') { l.props.x += g.props.x || 0; l.props.y += g.props.y || 0; }
    }
    s.layers = s.layers.filter((l) => l.id !== id);
  });

  const applyDrop = (targetId: string, pos: 'above' | 'below' | 'into') => {
    if (!drag || drag === targetId) return;
    const moving = sel.has(drag) ? ui.selectedLayers : [drag];
    updateScene(session, nodeId, t('layer.reorder'), (s) => {
      const isDesc = (a: string, b: string): boolean => { let cur = s.layers.find((l) => l.id === a); while (cur?.parentId) { if (cur.parentId === b) return true; cur = s.layers.find((l) => l.id === cur!.parentId); } return false; };
      if (moving.some((m) => m === targetId || isDesc(targetId, m))) return;
      const target = s.layers.find((l) => l.id === targetId)!;
      const moved = s.layers.filter((l) => moving.includes(l.id));
      s.layers = s.layers.filter((l) => !moving.includes(l.id));
      let idx = s.layers.findIndex((l) => l.id === targetId);
      for (const m of moved) m.parentId = pos === 'into' ? target.id : target.parentId;
      // list is drawn top-first, array is bottom-first: "above" in the panel = after in the array
      if (pos === 'above' || pos === 'into') idx += 1;
      s.layers.splice(idx, 0, ...moved);
    });
  };

  const icon = (l: Layer) => session.engine.layerTypes.get(l.type)?.icon || 'layers';

  return (
    <div className="layers-panel" onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest('input')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedLayers.length) { e.preventDefault(); deleteLayers(session, nodeId, ui.selectedLayers); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); group(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayers(session, nodeId, ui.selectedLayers); }
    }}>
      <div className="side-head">
        <span>{t('scene.layers')}</span>
        <span className="grow" />
        <IconButton icon="folder" size={14} title={`${t('layer.groupSelection')} (Mod+G)`} disabled={!ui.selectedLayers.length} onClick={group} />
        <IconButton icon="plus" size={14} title={t('layer.add')} onClick={(e) => { const { width, height } = session.project.settings.resolution; openMenu(e, addLayerMenu(session, nodeId, t, { x: width / 2, y: height / 2 })); }} />
      </div>
      <div className="layer-list" role="tree" tabIndex={-1}>
        {rows.map(({ layer: l, depth }) => {
          const def = session.engine.layerTypes.get(l.type);
          const animated = scene.animations.some((a) => a.tracks.some((tr) => tr.layerId === l.id));
          const scripted = scene.scripts.some((s) => JSON.stringify(s).includes(l.id));
          return (
            <div key={l.id} role="treeitem" aria-selected={sel.has(l.id)} tabIndex={0}
              className={cx('layer-row', sel.has(l.id) && 'active', !l.visible && 'hidden', drop?.id === l.id && `drop-${drop.pos}`, !def && 'missing')}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={(e) => select(e, l.id)}
              onDoubleClick={() => setRenaming(l.id)}
              draggable={renaming !== l.id}
              onDragStart={(e) => { setDrag(l.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.name); }}
              onDragEnd={() => { setDrag(null); setDrop(null); }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const y = (e.clientY - r.top) / r.height;
                setDrop({ id: l.id, pos: l.type === 'core.group' && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'above' : 'below' });
              }}
              onDrop={(e) => { e.preventDefault(); if (drop) applyDrop(drop.id, drop.pos); setDrag(null); setDrop(null); }}
              onContextMenu={(e) => { e.preventDefault(); if (!sel.has(l.id)) session.setSceneUI(nodeId, { selectedLayers: [l.id] }); const ids = sel.has(l.id) ? ui.selectedLayers : [l.id]; openMenu(e, [
                { label: t('common.rename'), icon: 'text', onClick: () => setRenaming(l.id) },
                { label: t('common.duplicate'), icon: 'duplicate', shortcut: 'Mod+D', onClick: () => duplicateLayers(session, nodeId, ids) },
                { label: t('layer.groupSelection'), icon: 'folder', onClick: group },
                ...(l.type === 'core.group' ? [{ label: t('layer.ungroup'), icon: 'folderOpen', onClick: () => ungroup(l.id) }] : []),
                { separator: true },
                { label: t('layer.bringFront'), icon: 'arrowUp', onClick: () => reorder(session, nodeId, ids, 'front') },
                { label: t('layer.forward'), onClick: () => reorder(session, nodeId, ids, 'up') },
                { label: t('layer.backward'), onClick: () => reorder(session, nodeId, ids, 'down') },
                { label: t('layer.sendBack'), icon: 'arrowDown', onClick: () => reorder(session, nodeId, ids, 'back') },
                { separator: true },
                { label: t('layer.saveComposition'), icon: 'layers', onClick: () => saveAsComposition(session, nodeId, ids) },
                ...(l.type === 'core.composition' && l.props.compositionId ? [{ label: t('layer.unpackComposition'), icon: 'folderOpen', onClick: () => unpackComposition(session, nodeId, l.id) }] : []),
                ...(l.type === 'core.group' && l.sourceCompositionId && session.project.compositions.some((c) => c.id === l.sourceCompositionId)
                  ? [{ label: t('layer.updateComposition', { name: session.project.compositions.find((c) => c.id === l.sourceCompositionId)!.name }), icon: 'refresh', onClick: () => updateComposition(session, nodeId, l.id) }] : []),
                { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteLayers(session, nodeId, ids) },
              ]); }}>
              {l.type === 'core.group' ? <Icon name="folder" size={14} className="layer-icon" /> : <Icon name={icon(l)} size={14} className="layer-icon" />}
              {renaming === l.id ? (
                <input className="inline-edit" autoFocus defaultValue={l.name} onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) updateScene(session, nodeId, t('common.rename'), (s) => { s.layers.find((x) => x.id === l.id)!.name = v; }); setRenaming(null); }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
              ) : <span className="layer-name" title={def ? t(def.label) : t('layer.missingType', { type: l.type })}>{l.name}</span>}
              {!def && <Icon name="warning" size={12} className="err" />}
              {animated && <Icon name="keyframe" size={11} className="layer-flag" />}
              {scripted && <Icon name="script" size={11} className="layer-flag" />}
              {l.effect && <Icon name="sparkles" size={11} className="layer-flag" />}
              <span className="layer-tools">
                <IconButton icon={l.locked ? 'lock' : 'unlock'} size={13} title={t('layer.toggleLock')} active={l.locked} onClick={(e) => { e.stopPropagation(); toggle(l.id, 'locked'); }} />
                <IconButton icon={l.visible ? 'eye' : 'eyeOff'} size={13} title={t('layer.toggleVisible')} onClick={(e) => { e.stopPropagation(); toggle(l.id, 'visible'); }} />
              </span>
            </div>
          );
        })}
        {!rows.length && <div className="muted small pad">{t('layer.none')}</div>}
      </div>
    </div>
  );
}

function saveAsComposition(session: ProjectSession, nodeId: string, ids: string[]): void {
  const t = session.i18n.t;
  const scene = session.project.nodes[nodeId].data as SceneData;
  const layers = scene.layers.filter((l) => ids.includes(l.id) || (l.parentId && ids.includes(l.parentId)));
  const { width, height } = session.project.settings.resolution;
  session.update(t('layer.saveComposition'), (d) => {
    d.compositions.push({ id: newId('cmp'), name: layers[0]?.name || t('layer.composition'), width, height, layers: JSON.parse(JSON.stringify(layers)) });
  });
  (globalThis as any).__vneStore?.toast(t('layer.compositionSaved'), 'success');
}

/** Replace a composition layer by an editable group holding copies of the composition's layers. */
function unpackComposition(session: ProjectSession, nodeId: string, layerId: string): void {
  const t = session.i18n.t;
  const scene = session.project.nodes[nodeId].data as SceneData;
  const inst = scene.layers.find((l) => l.id === layerId);
  const comp = session.project.compositions.find((c) => c.id === inst?.props.compositionId);
  if (!inst || !comp) return;
  const groupId = newId('lyr');
  const copies = remapIds(JSON.parse(JSON.stringify(comp.layers)) as Layer[]).value.map((l) => ({ ...l, parentId: l.parentId || groupId }));
  updateScene(session, nodeId, t('layer.unpackComposition'), (s) => {
    const i = s.layers.findIndex((l) => l.id === layerId);
    const group: Layer = { id: groupId, type: 'core.group', name: comp.name, parentId: inst.parentId, visible: inst.visible, locked: false, props: { ...inst.props }, sourceCompositionId: comp.id };
    delete group.props.compositionId;
    s.layers.splice(i, 1, group, ...copies);
  });
  session.setSceneUI(nodeId, { selectedLayers: [groupId] });
}

/** Write a group's layers back into the composition it was unpacked from (every instance updates). */
function updateComposition(session: ProjectSession, nodeId: string, groupId: string): void {
  const t = session.i18n.t;
  const scene = session.project.nodes[nodeId].data as SceneData;
  const group = scene.layers.find((l) => l.id === groupId);
  if (!group?.sourceCompositionId) return;
  const inside = new Set<string>([groupId]);
  let grew = true;
  while (grew) { grew = false; for (const l of scene.layers) if (l.parentId && inside.has(l.parentId) && !inside.has(l.id)) { inside.add(l.id); grew = true; } }
  const layers = scene.layers.filter((l) => l.id !== groupId && inside.has(l.id)).map((l) => ({ ...JSON.parse(JSON.stringify(l)), parentId: l.parentId === groupId ? null : l.parentId }));
  const name = session.project.compositions.find((c) => c.id === group.sourceCompositionId)?.name || '';
  session.update(t('layer.updateComposition', { name }), (d) => {
    const c = d.compositions.find((x) => x.id === group.sourceCompositionId);
    if (c) c.layers = remapIds(layers).value;
  });
  (globalThis as any).__vneStore?.toast(t('layer.compositionUpdated', { name }), 'success');
}
