/**
 * Game module editors: global variables (with lists), element variables (sprites and
 * their frames, media, regions, parameters) and collectible items. Used by the Game
 * category of Interactions, by double-clicking an element there, and by the inspector.
 */
import { useEffect, useMemo, useState, ReactNode } from 'react';
import type { Layer, ParamDef, ScalarValue, SceneData, VarType, VariableDef, ItemDef } from '@vne/core';
import { newId, variableUsage, toList, createLayer, createItem, ensureInventoryVar, GLOBAL_NODE_ID, ensureGlobalNode } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { Button, Field, IconButton, NumberInput, Select, TextInput, Toggle, cx } from '../ui/controls';
import { openMenu, MenuItem } from '../ui/Menu';
import { AssetPicker, AssetThumb } from '../inspect/AssetPicker';
import { importFiles } from '../sidebar/AssetLibrary';
import { updateScene, addLayer } from '../scene/sceneOps';
import { addLayerMenu, ensureInventory } from '../scene/CompositionCanvas';
import { pageElements, moveElements, pageName, openGlobalPage, PageElement } from '../scene/pageContext';

export const VALUE_TYPES: VarType[] = ['number', 'string', 'boolean', 'list'];
const TYPE_ICON: Record<string, string> = { number: 'hash', string: 'type', boolean: 'check', list: 'listOrdered' };

export function initialFor(type: VarType): VariableDef['initial'] {
  return type === 'number' ? 0 : type === 'boolean' ? false : type === 'list' ? [] : '';
}

/** Convert a value when a variable changes type. */
function convert(v: VariableDef['initial'], type: VarType): VariableDef['initial'] {
  if (type === 'list') return toList(v);
  const first = Array.isArray(v) ? v[0] ?? '' : v;
  if (type === 'number') return Number(first) || 0;
  if (type === 'boolean') return first === true || first === 'true' || Number(first) > 0;
  return Array.isArray(v) ? v.join(', ') : String(first ?? '');
}

/** Text typed in a list or parameter field: numbers stay numbers. */
export function parseScalar(s: string): ScalarValue {
  const x = s.trim();
  if (x === 'true') return true;
  if (x === 'false') return false;
  if (x !== '' && !Number.isNaN(Number(x))) return Number(x);
  return s;
}

/* ------------------------------------------------------------------ */
/* Global variables                                                    */
/* ------------------------------------------------------------------ */

export function addVariable(session: ProjectSession, type: VarType, name?: string): string {
  const t = session.i18n.t;
  const base = name || (type === 'list' ? 'list' : 'var');
  let n = 1;
  while (session.project.variables.some((v) => v.name === `${base}${n}`)) n++;
  const id = newId('var');
  session.update(t('vars.add'), (d) => { d.variables.push({ id, name: `${base}${n}`, type, initial: initialFor(type), scope: 'game' }); });
  return id;
}

export function ListItemsEditor({ items, onChange }: { items: ScalarValue[]; onChange: (v: ScalarValue[]) => void }) {
  const t = useT();
  return (
    <div className="list-items">
      {items.map((v, i) => (
        <div key={i} className="list-item-row">
          <span className="list-index">{i + 1}</span>
          <TextInput value={String(v)} onChange={(x) => { const next = [...items]; next[i] = parseScalar(x); onChange(next); }} ariaLabel={t('vars.listItem', { n: i + 1 })} />
          <IconButton icon="arrowUp" size={12} title={t('common.moveUp')} disabled={i === 0} onClick={() => { const next = [...items]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next); }} />
          <IconButton icon="close" size={12} title={t('common.delete')} onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!items.length && <div className="muted small">{t('vars.listEmpty')}</div>}
      <Button small icon="plus" onClick={() => onChange([...items, ''])}>{t('vars.listAdd')}</Button>
    </div>
  );
}

export function VariableModal({ session, varId, onClose }: { session: ProjectSession; varId: string; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const v = session.project.variables.find((x) => x.id === varId);
  const usage = useMemo(() => variableUsage(session.project).get(varId)?.length || 0, [session.project, varId]);
  useEffect(() => { if (!v) onClose(); }, [v]);
  if (!v) return null;
  const upd = (fn: (x: VariableDef) => void, merge?: string) => session.update(t('vars.edit'), (d) => { const x = d.variables.find((y) => y.id === varId); if (x) fn(x); }, merge ? { mergeKey: merge } : undefined);
  const isInventory = session.project.inventoryVarId === varId;
  return (
    <Modal title={<>{t('game.variable')}: {v.name}</>} icon={<Icon name={TYPE_ICON[v.type] || 'variable'} size={16} />} width={480} onClose={onClose}
      footer={<>
        <span className="muted small">{t('vars.usedIn', { n: usage })}</span>
        <span className="grow" />
        <Button kind="danger" icon="trash" onClick={async () => {
          if (usage && !(await store.confirm(t('vars.deleteTitle'), t('vars.deleteUsed', { name: v.name, n: usage }), t('common.delete'), true))) return;
          session.update(t('vars.delete'), (d) => { d.variables = d.variables.filter((x) => x.id !== varId); if (d.inventoryVarId === varId) d.inventoryVarId = null; });
          onClose();
        }}>{t('common.delete')}</Button>
        <Button kind="primary" onClick={onClose}>{t('common.done')}</Button>
      </>}>
      <div className="game-form">
        <Field label={t('common.name')}><TextInput value={v.name} autoFocus onChange={(name) => upd((x) => { x.name = name.trim() || x.name; })} /></Field>
        <Field label={t('vars.type')} hint={t('game.typeHint')}>
          <div className="seg">
            {VALUE_TYPES.map((ty) => (
              <button key={ty} type="button" className={cx('seg-btn', v.type === ty && 'active')} onClick={() => upd((x) => { x.initial = convert(x.initial, ty); x.type = ty; })}>
                <Icon name={TYPE_ICON[ty]} size={13} />{t(`vars.${ty}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('vars.scope')}>
          <Select value={v.scope} options={[{ value: 'game', label: t('vars.scope.game') }, { value: 'persistent', label: t('vars.scope.persistent') }]} onChange={(s) => upd((x) => { x.scope = s as any; })} />
        </Field>
        <Field label={v.type === 'list' ? t('vars.listItems') : t('vars.initial')}>
          {v.type === 'boolean' ? <Toggle value={v.initial === true} onChange={(b) => upd((x) => { x.initial = b; })} />
            : v.type === 'number' ? <NumberInput value={Number(v.initial) || 0} onChange={(n, tr) => upd((x) => { x.initial = n; }, tr ? `var-${varId}` : undefined)} />
              : v.type === 'list' ? <ListItemsEditor items={toList(v.initial)} onChange={(items) => upd((x) => { x.initial = items; })} />
                : <TextInput value={String(v.initial ?? '')} onChange={(s) => upd((x) => { x.initial = s; })} />}
        </Field>
        <Field label={t('common.description')}><TextInput value={v.description || ''} multiline rows={2} onChange={(s) => upd((x) => { x.description = s; })} /></Field>
        <div className="muted small">{t('game.variableShared')}{isInventory ? ` ${t('items.isInventory')}` : ''}</div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Element parameters                                                   */
/* ------------------------------------------------------------------ */

/** The page that owns an element (a page, or the global page). */
export function ownerOf(session: ProjectSession, layerId: string): string | null {
  for (const n of Object.values(session.project.nodes)) if ((n.data as SceneData)?.layers?.some?.((l) => l.id === layerId)) return n.id;
  return null;
}

function findLayer(session: ProjectSession, nodeId: string, layerId: string): Layer | undefined {
  return (session.project.nodes[nodeId]?.data as SceneData | undefined)?.layers.find((l) => l.id === layerId);
}

export function ParamsEditor({ session, nodeId, layer }: { session: ProjectSession; nodeId: string; layer: Layer }) {
  const t = useT();
  const params = layer.params || [];
  const upd = (label: string, fn: (list: ParamDef[]) => ParamDef[], merge?: string) => updateScene(session, nodeId, label, (s) => {
    const l = s.layers.find((x) => x.id === layer.id);
    if (l) l.params = fn([...(l.params || [])].map((p) => ({ ...p })));
  }, merge);
  const add = () => {
    let n = params.length + 1;
    while (params.some((p) => p.name === `param${n}`)) n++;
    upd(t('params.add'), (list) => [...list, { id: newId('prm'), name: n === 1 && !params.some((p) => p.name === 'hp') ? 'hp' : `param${n}`, type: 'number', initial: n === 1 ? 100 : 0 }]);
  };
  return (
    <div className="params-editor">
      {params.map((p) => (
        <div key={p.id} className="param-row">
          <TextInput value={p.name} ariaLabel={t('common.name')} onChange={(name) => upd(t('params.edit'), (list) => list.map((x) => (x.id === p.id ? { ...x, name: name.trim().replace(/\s+/g, '_') || x.name } : x)))} />
          <Select value={p.type} title={t('vars.type')} options={(['number', 'string', 'boolean'] as const).map((ty) => ({ value: ty, label: t(`vars.${ty}`) }))}
            onChange={(ty) => upd(t('params.edit'), (list) => list.map((x) => (x.id === p.id ? { ...x, type: ty as ParamDef['type'], initial: convert(x.initial, ty as VarType) as ScalarValue } : x)))} />
          {p.type === 'boolean'
            ? <Toggle value={p.initial === true} onChange={(b) => upd(t('params.edit'), (list) => list.map((x) => (x.id === p.id ? { ...x, initial: b } : x)))} />
            : <TextInput value={String(p.initial)} className="narrow" ariaLabel={t('vars.initial')} onChange={(s) => upd(t('params.edit'), (list) => list.map((x) => (x.id === p.id ? { ...x, initial: p.type === 'number' ? Number(s) || 0 : s } : x)))} />}
          <IconButton icon="close" size={12} title={t('common.delete')} onClick={() => upd(t('params.delete'), (list) => list.filter((x) => x.id !== p.id))} />
        </div>
      ))}
      {!params.length && <div className="muted small">{t('params.empty')}</div>}
      <Button small icon="plus" onClick={add}>{t('params.add')}</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sprite frames                                                        */
/* ------------------------------------------------------------------ */

async function importImages(session: ProjectSession): Promise<string[]> {
  const paths = await store.pickFiles(session.i18n.t('sprite.import'), [{ name: session.i18n.t('layer.image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'] }]);
  if (!paths?.length) return [];
  const assets = await importFiles(session, paths);
  return assets.filter((a) => a.kind === 'image').map((a) => a.id);
}

export function SpriteFramesEditor({ session, nodeId, layer, settings = true }: { session: ProjectSession; nodeId: string; layer: Layer; settings?: boolean }) {
  const t = useT();
  const frames: { assetId: string | null }[] = Array.isArray(layer.props.frames) ? layer.props.frames : [];
  const current = Math.max(1, Math.floor(Number(layer.props.frame) || 1));
  const fps = Math.max(0, Number(layer.props.fps) || 8);
  const url = (id: string | null) => { const a = id ? session.project.assets.find((x) => x.id === id) : null; return a ? session.assetUrl(a) : null; };
  const setProps = (label: string, patch: Record<string, any>) => updateScene(session, nodeId, label, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) Object.assign(l.props, patch); });
  const setFrames = (label: string, fn: (f: { assetId: string | null }[]) => { assetId: string | null }[]) => updateScene(session, nodeId, label, (s) => {
    const l = s.layers.find((x) => x.id === layer.id);
    if (!l) return;
    const next = fn(Array.isArray(l.props.frames) ? l.props.frames.map((f: any) => ({ ...f })) : []);
    l.props.frames = next;
    if (Number(l.props.frame) > next.length) l.props.frame = Math.max(1, next.length);
  });
  const addAssets = (ids: string[]) => { if (ids.length) setFrames(t('sprite.addFrame'), (f) => [...f, ...ids.map((assetId) => ({ assetId }))]); };
  // Animated preview at the sprite's speed.
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || frames.length < 2 || fps <= 0) return;
    const h = setInterval(() => setTick((x) => x + 1), 1000 / Math.min(60, fps));
    return () => clearInterval(h);
  }, [playing, frames.length, fps]);
  const previewIndex = frames.length ? (playing ? tick % frames.length : current - 1) : -1;
  const images = session.project.assets.filter((a) => a.kind === 'image');
  const imageElements = pageElements(session, nodeId).filter((e) => (e.layer.type === 'core.image' || e.layer.type === 'core.background') && e.layer.props.assetId);
  const addMenu = (e: React.MouseEvent) => openMenu(e, [
    { header: true, label: t('sprite.fromLibrary') },
    ...(images.length ? images.map((a) => ({ label: a.name, icon: 'image', onClick: () => addAssets([a.id]) })) : [{ label: t('assets.noneOfKind'), disabled: true }]),
    { separator: true },
    { label: t('sprite.import'), icon: 'upload', onClick: async () => addAssets(await importImages(session)) },
    ...(imageElements.length ? [{ label: t('sprite.fromElement'), icon: 'layers', submenu: imageElements.map((x) => ({ label: x.layer.name, icon: 'image', onClick: () => addAssets([x.layer.props.assetId]) })) }] : []),
    { label: t('sprite.emptyFrame'), icon: 'square', onClick: () => setFrames(t('sprite.addFrame'), (f) => [...f, { assetId: null }]) },
  ] as MenuItem[], { search: images.length > 8 });
  return (
    <div className="sprite-editor">
      <div className="sprite-top">
        <div className="sprite-preview" title={t('sprite.preview')}>
          {previewIndex >= 0 && url(frames[previewIndex]?.assetId) ? <img src={url(frames[previewIndex].assetId)!} alt="" /> : <Icon name="sprite" size={28} />}
          <span className="sprite-preview-num">{previewIndex >= 0 ? `${previewIndex + 1} / ${frames.length}` : '0'}</span>
        </div>
        <div className="sprite-settings">
          {settings && <>
          <Field label={t('prop.fps')}><NumberInput value={fps} min={0} max={60} onChange={(v) => setProps(t('sprite.speed'), { fps: v })} /></Field>
          <Field label={t('prop.loop')}><Toggle value={layer.props.loop !== false} onChange={(v) => setProps(t('sprite.loop'), { loop: v })} /></Field>
          <Field label={t('prop.spritePlaying')} hint={t('prop.spritePlaying.desc')}><Toggle value={!!layer.props.playing} onChange={(v) => setProps(t('sprite.autoplay'), { playing: v })} /></Field>
          </>}
          <Button small icon={playing ? 'pause' : 'play'} onClick={() => setPlaying(!playing)}>{playing ? t('sprite.pausePreview') : t('sprite.playPreview')}</Button>
        </div>
      </div>
      <div className="sprite-frames" role="list">
        {frames.map((f, i) => (
          <div key={i} role="listitem" className={cx('sprite-frame', i + 1 === current && 'current', previewIndex === i && 'previewing')}
            title={t('sprite.frameHint', { n: i + 1 })}
            onClick={() => setProps(t('sprite.showFrame'), { frame: i + 1 })}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-vne-asset')) e.preventDefault(); }}
            onDrop={(e) => { const id = e.dataTransfer.getData('application/x-vne-asset'); if (id) { e.preventDefault(); setFrames(t('sprite.replaceFrame'), (list) => list.map((x, j) => (j === i ? { assetId: id } : x))); } }}>
            {url(f.assetId) ? <img src={url(f.assetId)!} alt="" /> : <Icon name={f.assetId ? 'warning' : 'square'} size={18} />}
            <span className="sprite-frame-num">{i + 1}</span>
            <span className="sprite-frame-tools" onClick={(e) => e.stopPropagation()}>
              <IconButton icon="chevronLeft" size={11} title={t('sprite.moveEarlier')} disabled={i === 0} onClick={() => setFrames(t('sprite.reorder'), (list) => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} />
              <IconButton icon="duplicate" size={11} title={t('common.duplicate')} onClick={() => setFrames(t('sprite.addFrame'), (list) => [...list.slice(0, i + 1), { ...list[i] }, ...list.slice(i + 1)])} />
              <IconButton icon="close" size={11} title={t('common.delete')} onClick={() => setFrames(t('sprite.deleteFrame'), (list) => list.filter((_, j) => j !== i))} />
            </span>
          </div>
        ))}
        <button type="button" className="sprite-frame add" onClick={addMenu} title={t('sprite.addFrameHint')}><Icon name="plus" size={18} /><span>{t('sprite.addFrame')}</span></button>
      </div>
      <div className="muted small">{t('sprite.blocksHint')}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Element variables                                                    */
/* ------------------------------------------------------------------ */

/** Element types that can turn into each other (properties carry over). */
const FAMILIES = [['core.image', 'core.sprite', 'core.background'], ['core.text', 'core.button'], ['core.hotspot', 'core.shape'], ['core.audio'], ['core.video']];

export function typeFamily(type: string): string[] {
  return FAMILIES.find((f) => f.includes(type)) || [type];
}

/** Change an element's type, keeping its id, name, parameters and the properties both types share. */
export function convertElement(session: ProjectSession, nodeId: string, layerId: string, type: string): void {
  const t = session.i18n.t;
  updateScene(session, nodeId, t('game.changeType'), (s, d) => {
    const i = s.layers.findIndex((l) => l.id === layerId);
    if (i < 0) return;
    const old = s.layers[i];
    const fresh = createLayer(session.engine, d, type, old.name);
    const keys = new Set(session.engine.layerProps(type).map((p) => p.key));
    const props: Record<string, any> = { ...fresh.props };
    for (const [k, v] of Object.entries(old.props)) if (keys.has(k) || k.startsWith('param.') || k.startsWith('fx.')) props[k] = v;
    // Image ↔ sprite: the picture becomes the first frame and back.
    if (type === 'core.sprite' && old.props.assetId && !(Array.isArray(old.props.frames) && old.props.frames.length)) props.frames = [{ assetId: old.props.assetId }];
    if (type !== 'core.sprite' && old.type === 'core.sprite' && !props.assetId) props.assetId = old.props.frames?.[Math.max(0, (Number(old.props.frame) || 1) - 1)]?.assetId ?? old.props.frames?.[0]?.assetId ?? null;
    s.layers[i] = { ...old, type, props };
  });
}

export function ElementModal({ session, nodeId, layerId, onClose }: { session: ProjectSession; nodeId: string; layerId: string; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const owner = ownerOf(session, layerId);
  const layer = owner ? findLayer(session, owner, layerId) : undefined;
  useEffect(() => { if (!layer) onClose(); }, [layer]);
  if (!layer || !owner) return null;
  const def = session.engine.layerTypes.get(layer.type);
  const family = typeFamily(layer.type).filter((x) => session.engine.layerTypes.has(x));
  const isGlobal = owner === GLOBAL_NODE_ID;
  const elsewhere = owner !== nodeId;
  const url = (id: string) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };
  const setProps = (label: string, patch: Record<string, any>) => updateScene(session, owner, label, (s) => { const l = s.layers.find((x) => x.id === layerId); if (l) Object.assign(l.props, patch); });
  const media = layer.type === 'core.image' || layer.type === 'core.background' ? 'image' : layer.type === 'core.audio' ? 'audio' : layer.type === 'core.video' ? 'video' : null;
  return (
    <Modal title={<>{t('game.element')}: {layer.name}</>} icon={<Icon name={def?.icon || 'layers'} size={16} />} width={layer.type === 'core.sprite' ? 720 : 520} onClose={onClose}
      footer={<>
        <span className="muted small">{isGlobal ? t('game.inGlobal') : elsewhere ? t('game.onPage', { page: pageName(session, owner) }) : t('game.onThisPage')}</span>
        <span className="grow" />
        {!isGlobal && <Button icon="globe" onClick={() => moveElements(session, owner, GLOBAL_NODE_ID, [layerId])} title={t('global.makeGlobalHint')}>{t('global.makeGlobal')}</Button>}
        {isGlobal && nodeId !== GLOBAL_NODE_ID && <Button icon="arrowDown" onClick={() => moveElements(session, GLOBAL_NODE_ID, nodeId, [layerId])}>{t('global.moveHere')}</Button>}
        <Button icon="panel" onClick={() => { if (isGlobal && nodeId !== GLOBAL_NODE_ID) openGlobalPage(session, layerId); else if (elsewhere) { session.openNode(owner); session.setSceneUI(owner, { selectedLayers: [layerId] }); } else session.setSceneUI(nodeId, { selectedLayers: [layerId] }); onClose(); }}>{t('game.inspect')}</Button>
        <Button kind="primary" onClick={onClose}>{t('common.done')}</Button>
      </>}>
      <div className="game-form">
        <Field label={t('common.name')}><TextInput value={layer.name} autoFocus onChange={(name) => updateScene(session, owner, t('common.rename'), (s) => { const l = s.layers.find((x) => x.id === layerId); if (l && name.trim()) l.name = name.trim(); })} /></Field>
        <Field label={t('vars.type')} hint={family.length > 1 ? t('game.elementTypeHint') : undefined}>
          {family.length > 1
            ? <div className="seg">{family.map((ty) => { const d = session.engine.layerTypes.get(ty)!; return <button key={ty} type="button" className={cx('seg-btn', ty === layer.type && 'active')} onClick={() => ty !== layer.type && convertElement(session, owner, layerId, ty)}><Icon name={d.icon || 'layers'} size={13} />{t(d.label)}</button>; })}</div>
            : <span className="type-chip"><Icon name={def?.icon || 'layers'} size={13} />{def ? t(def.label) : layer.type}</span>}
        </Field>
        {layer.type === 'core.sprite' && <SpriteFramesEditor session={session} nodeId={owner} layer={layer} />}
        {media && <Field label={t(`prop.${media === 'image' ? 'image' : media}`)}><AssetPicker project={session.project} kind={media} value={layer.props.assetId ?? null} onChange={(id) => setProps(t('layer.edit'), { assetId: id })} assetUrl={url} t={t} /></Field>}
        {(layer.type === 'core.audio' || layer.type === 'core.video') && <>
          <Field label={t('prop.autoplay')}><Toggle value={!!layer.props.autoplay} onChange={(v) => setProps(t('layer.edit'), { autoplay: v })} /></Field>
          <Field label={t('prop.loop')}><Toggle value={!!layer.props.loop} onChange={(v) => setProps(t('layer.edit'), { loop: v })} /></Field>
        </>}
        {layer.type === 'core.hotspot' && <Field label={t('prop.regionShape')}><Select value={layer.props.shape || 'rect'} options={['rect', 'ellipse', 'polygon'].map((v) => ({ value: v, label: t(`region.${v}`) }))} onChange={(v) => setProps(t('layer.edit'), { shape: v })} /></Field>}
        {(layer.type === 'core.text' || layer.type === 'core.button') && <Field label={t('prop.text')}><TextInput value={String(layer.props.text ?? '')} multiline={layer.type === 'core.text'} rows={2} onChange={(v) => setProps(t('layer.edit'), { text: v })} /></Field>}
        <div className="game-sub"><Icon name="sliders" size={13} />{t('params.title')}<span className="muted small">{t('params.hint')}</span></div>
        <ParamsEditor session={session} nodeId={owner} layer={layer} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Items (collectibles)                                                 */
/* ------------------------------------------------------------------ */

/** Places that use an item (blocks and choices). */
export function itemUsage(session: ProjectSession, item: ItemDef): number {
  let n = 0;
  const walk = (b: any) => {
    if (!b) return;
    for (const v of Object.values(b.args || {})) { if (v === item.id || v === item.name) n++; if ((v as any)?.k === 'block') walk((v as any).block); }
    (b.body || []).forEach(walk); (b.else || []).forEach(walk);
  };
  for (const node of Object.values(session.project.nodes)) {
    const d = node.data as SceneData;
    for (const s of d?.scripts || []) { walk(s.hat); s.body.forEach(walk); }
    for (const l of d?.layers || []) if (l.props?.requiresItem && (l.props.requiresItem === item.id || l.props.requiresItem === item.name)) n++;
  }
  return n;
}

export function newItem(session: ProjectSession, name?: string, assetId: string | null = null): string {
  const t = session.i18n.t;
  let id = '';
  session.update(t('items.add'), (d) => { id = createItem(d, name || t('items.newName', { n: d.items.length + 1 }), assetId).id; ensureInventoryVar(d, t('items.inventoryName')); });
  return id;
}

export function ItemModal({ session, itemId, onClose }: { session: ProjectSession; itemId: string; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const item = session.project.items.find((x) => x.id === itemId);
  useEffect(() => { if (!item) onClose(); }, [item]);
  if (!item) return null;
  const url = (id: string) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };
  const upd = (fn: (x: ItemDef) => void) => session.update(t('items.edit'), (d) => { const x = d.items.find((y) => y.id === itemId); if (x) fn(x); });
  const used = itemUsage(session, item);
  const inv = session.project.variables.find((v) => v.id === session.project.inventoryVarId);
  return (
    <Modal title={<>{t('items.item')}: {item.name}</>} icon={<Icon name="gem" size={16} />} width={460} onClose={onClose}
      footer={<>
        <span className="muted small">{t('items.usedIn', { n: used })}</span>
        <span className="grow" />
        <Button kind="danger" icon="trash" onClick={async () => {
          if (used && !(await store.confirm(t('items.deleteTitle'), t('items.deleteUsed', { name: item.name, n: used }), t('common.delete'), true))) return;
          session.update(t('items.delete'), (d) => { d.items = d.items.filter((x) => x.id !== itemId); });
          onClose();
        }}>{t('common.delete')}</Button>
        <Button kind="primary" onClick={onClose}>{t('common.done')}</Button>
      </>}>
      <div className="game-form">
        <Field label={t('common.name')} hint={t('items.nameHint')}><TextInput value={item.name} autoFocus onChange={(name) => upd((x) => { x.name = name.trim() || x.name; })} /></Field>
        <Field label={t('items.icon')}><AssetPicker project={session.project} kind="image" value={item.assetId} onChange={(id) => upd((x) => { x.assetId = id; })} assetUrl={url} t={t} /></Field>
        <Field label={t('common.description')}><TextInput value={item.description || ''} multiline rows={2} onChange={(s) => upd((x) => { x.description = s; })} /></Field>
        <div className="muted small">{t('items.howTo', { list: inv?.name || t('items.inventoryName') })}</div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* The Game category of Interactions                                    */
/* ------------------------------------------------------------------ */

export interface GamePanelApi {
  /** Start dragging an element (into an element slot, or onto the canvas for a new script). */
  dragElement(e: React.PointerEvent, layerId: string, label: string): void;
  /** Start dragging a block from the palette with some arguments filled in. */
  dragBlock(e: React.PointerEvent, defId: string, args: Record<string, any>): void;
}

export type GameOpen = { kind: 'var'; id: string } | { kind: 'element'; id: string } | { kind: 'item'; id: string } | null;

/** The editor window for whatever the Game panel opened (kept by the parent so it survives palette changes). */
export function GameModal({ session, nodeId, open, onClose }: { session: ProjectSession; nodeId: string; open: GameOpen; onClose: () => void }) {
  if (open?.kind === 'var') return <VariableModal session={session} varId={open.id} onClose={onClose} />;
  if (open?.kind === 'element') return <ElementModal session={session} nodeId={nodeId} layerId={open.id} onClose={onClose} />;
  if (open?.kind === 'item') return <ItemModal session={session} itemId={open.id} onClose={onClose} />;
  return null;
}

export function GamePanel({ session, nodeId, api, setOpen }: { session: ProjectSession; nodeId: string; api: GamePanelApi; setOpen: (o: GameOpen) => void }) {
  useSession(session);
  const t = useT();
  const project = session.project;
  const elements = pageElements(session, nodeId).filter((e) => e.layer.type !== 'core.dialogue' && e.layer.type !== 'core.choice');
  const { width: W, height: H } = project.settings.resolution;
  const url = (id: string | null) => { const a = id ? project.assets.find((x) => x.id === id) : null; return a ? session.assetUrl(a) : null; };
  const preview = (v: VariableDef) => (v.type === 'list' ? `[${toList(v.initial).length}]` : v.type === 'boolean' ? (v.initial ? t('expr.true') : t('expr.false')) : String(v.initial ?? '')).slice(0, 14);
  const newVar = (type: VarType) => setOpen({ kind: 'var', id: addVariable(session, type) });
  const newSprite = (global: boolean) => {
    const target = global ? GLOBAL_NODE_ID : nodeId;
    if (global) session.update(t('global.title'), (d) => { ensureGlobalNode(d); });
    const id = addLayer(session, target, 'core.sprite', { x: W / 2, y: H / 2 }, t('game.newSprite'));
    if (id) setOpen({ kind: 'element', id });
  };
  const addMenu = (e: React.MouseEvent) => openMenu(e, [
    { header: true, label: t('game.globalVars') },
    { label: t('vars.number'), icon: 'hash', onClick: () => newVar('number') },
    { label: t('vars.string'), icon: 'type', onClick: () => newVar('string') },
    { label: t('vars.boolean'), icon: 'check', onClick: () => newVar('boolean') },
    { label: t('vars.list'), icon: 'listOrdered', onClick: () => newVar('list') },
    { header: true, label: t('game.elementVars') },
    { label: t('game.newSprite'), icon: 'sprite', hint: t('layer.sprite.hint'), onClick: () => newSprite(false) },
    { label: t('game.newElement'), icon: 'layers', submenu: addLayerMenu(session, nodeId, t, { x: W / 2, y: H / 2 }, { fromScripts: true, nested: true }) },
    { label: t('element.addGlobal'), icon: 'globe', hint: t('element.addGlobalHint'), submenu: addLayerMenu(session, GLOBAL_NODE_ID, t, { x: W / 2, y: H / 2 }, { nested: true }) },
    { header: true, label: t('items.title') },
    { label: t('items.add'), icon: 'gem', onClick: () => setOpen({ kind: 'item', id: newItem(session) }) },
    { label: t('layer.inventory'), icon: 'backpack', hint: t('layer.inventory.hint'), onClick: () => { ensureInventory(session); session.update(t('global.title'), (d) => { ensureGlobalNode(d); }); addLayer(session, GLOBAL_NODE_ID, 'core.inventory', { x: 40, y: 40, anchorX: 0, anchorY: 0 }); store.toast(t('global.added'), 'success', { label: t('global.open'), run: () => openGlobalPage(session) }); } },
  ] as MenuItem[]);
  const chip = (e: PageElement) => e.origin === 'global' ? <span className="game-origin" title={t('global.row')}><Icon name="globe" size={10} /></span>
    : e.origin === 'inherited' ? <span className="game-origin" title={t(e.paused ? 'inherit.rowPaused' : 'inherit.row', { page: pageName(session, e.from) })}><Icon name={e.paused ? 'paused' : 'inherit'} size={10} /></span> : null;
  const section = (title: string, icon: string, hint: string, body: ReactNode) => (
    <div className="game-section">
      <div className="game-head" title={hint}><Icon name={icon} size={12} />{title}</div>
      {body}
    </div>
  );
  return (
    <div className="game-panel">
      <button type="button" className="blk-new-el" onClick={addMenu} title={t('game.newHint')}><Icon name="plus" size={13} />{t('game.new')}</button>
      {section(t('game.globalVars'), 'variable', t('game.globalVarsHint'), (
        <div className="game-list">
          {project.variables.map((v) => (
            <div key={v.id} className="game-var" onDoubleClick={() => setOpen({ kind: 'var', id: v.id })} title={t('game.varHint')}>
              <span className="game-chip" onPointerDown={(e) => api.dragBlock(e, 'core.varValue', { variable: v.id })}><Icon name={TYPE_ICON[v.type] || 'variable'} size={11} /><span className="nm">{v.name}</span></span>
              <span className="game-val muted">{preview(v)}</span>
              <IconButton icon="settings" size={11} title={t('game.edit')} onClick={() => setOpen({ kind: 'var', id: v.id })} />
            </div>
          ))}
          {!project.variables.length && <div className="muted small pad">{t('vars.emptyText')}</div>}
        </div>
      ))}
      {section(t('game.elementVars'), 'sprite', t('game.elementVarsHint'), (
        <div className="game-list">
          {elements.map((e) => {
            const def = session.engine.layerTypes.get(e.layer.type);
            const frames = e.layer.type === 'core.sprite' && Array.isArray(e.layer.props.frames) ? e.layer.props.frames.length : null;
            const thumb = e.layer.type === 'core.sprite' ? url(e.layer.props.frames?.[0]?.assetId) : e.layer.type === 'core.image' ? url(e.layer.props.assetId) : null;
            return (
              <div key={e.layer.id} className={cx('game-var', e.origin !== 'own' && 'context')} onDoubleClick={() => setOpen({ kind: 'element', id: e.layer.id })} title={t('game.elementHint')}>
                <span className="game-chip el" onPointerDown={(ev) => api.dragElement(ev, e.layer.id, e.layer.name)}>
                  {thumb ? <img src={thumb} alt="" className="game-thumb" /> : <Icon name={def?.icon || 'layers'} size={11} />}<span className="nm">{e.layer.name}</span>
                </span>
                {chip(e)}
                <span className="game-val muted">{frames !== null ? t('sprite.nFrames', { n: frames }) : def ? t(def.label) : e.layer.type}{e.layer.params?.length ? ` · ${e.layer.params.length}P` : ''}</span>
                <IconButton icon="settings" size={11} title={t('game.edit')} onClick={() => setOpen({ kind: 'element', id: e.layer.id })} />
              </div>
            );
          })}
          {!elements.length && <div className="muted small pad">{t('script.noElements')}</div>}
        </div>
      ))}
      {section(t('items.title'), 'gem', t('items.hint'), (
        <div className="game-list">
          {project.items.map((it) => (
            <div key={it.id} className="game-var" onDoubleClick={() => setOpen({ kind: 'item', id: it.id })} title={t('items.rowHint')}>
              <span className="game-chip item" onPointerDown={(e) => api.dragBlock(e, 'core.hasItem', { item: it.id })}>
                {url(it.assetId) ? <img src={url(it.assetId)!} alt="" className="game-thumb" /> : <Icon name="gem" size={11} />}<span className="nm">{it.name}</span>
              </span>
              <span className="grow" />
              <IconButton icon="settings" size={11} title={t('game.edit')} onClick={() => setOpen({ kind: 'item', id: it.id })} />
            </div>
          ))}
          {!project.items.length && <div className="muted small pad">{t('items.empty')}</div>}
        </div>
      ))}
    </div>
  );
}
