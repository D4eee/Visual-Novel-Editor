import { useEffect, useState } from 'react';
import type { EffectPreset, Layer, SceneData } from '@vne/core';
import { presetFromEffect, effectFromPreset, presetWarnings, effectGraphOf, EFFECT_PRESET_EXT } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store, useT, useStore } from '../state/store';

const tr = (key: string, params?: Record<string, string | number>) => store.t(key, params);
import { call } from '../host';
import { sceneOf, updateScene } from '../scene/sceneOps';
import { EFFECT_PRESETS } from './presets';
import type { MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Button, IconButton, TextInput, Empty, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';

/* ------------------------------------------------------------------ */
/* Library (the user's presets, shared by all projects)                */
/* ------------------------------------------------------------------ */

let cache: EffectPreset[] | null = null;
let loading: Promise<EffectPreset[]> | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) l(); };

export function loadEffectPresets(force = false): Promise<EffectPreset[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (!loading || force) {
    loading = call('effectPresets.list').then((list: EffectPreset[]) => { cache = list || []; loading = null; changed(); return cache; })
      .catch(() => { cache = cache || []; loading = null; changed(); return cache; });
  }
  return loading;
}

/** The preset library (loads on first use, updates when presets are saved, imported or deleted). */
export function useEffectPresets(): EffectPreset[] | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    if (!cache) loadEffectPresets();
    return () => { listeners.delete(l); };
  }, []);
  return cache;
}

/* ------------------------------------------------------------------ */
/* Manager window state (kept apart from store dialogs, so prompts,     */
/* confirmations and folder pickers can open on top of it)              */
/* ------------------------------------------------------------------ */

let manager: { nodeId?: string; layerIds?: string[] } | null = null;
export function openPresetManager(nodeId?: string, layerIds?: string[]): void { manager = { nodeId, layerIds }; changed(); }
export function closePresetManager(): void { manager = null; changed(); }

/** Renders the preset manager while it is open (mounted once in the app). */
export function PresetManagerHost({ session }: { session: ProjectSession | null }) {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump((n) => n + 1); listeners.add(l); loadEffectPresets(); return () => { listeners.delete(l); }; }, []);
  if (!manager || !session) return null;
  return <EffectPresetManager session={session} nodeId={manager.nodeId} layerIds={manager.layerIds} onClose={closePresetManager} />;
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

/** Save an element's effect as a preset (asks for a name; offers to replace a preset with the same name). */
export async function saveEffectAsPreset(session: ProjectSession, layer: Layer): Promise<EffectPreset | null> {
  if (!layer.effect) return null;
  const graph = effectGraphOf(session.project, layer.effect);
  const name = (await store.prompt(tr('fxp.saveTitle'), tr('fxp.name'), graph?.name && graph.name !== 'Effect' ? graph.name : `${layer.name} ${tr('effects.title').toLowerCase()}`))?.trim();
  if (!name) return null;
  const list = await loadEffectPresets();
  const same = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const preset = presetFromEffect(session.project, layer.effect, name, same?.description);
  if (same) {
    const ok = await store.confirm(tr('fxp.replaceTitle'), tr('fxp.replaceText', { name: same.name }), tr('fxp.replace'));
    if (!ok) return null;
    preset.id = same.id;
  }
  try {
    const saved: EffectPreset = await call('effectPresets.save', { preset });
    await loadEffectPresets(true);
    store.toast(tr('fxp.saved', { name: saved.name }), 'success');
    return saved;
  } catch (e: any) {
    store.toast(`${tr('fxp.saveFailed')}: ${e?.message || e}`, 'error');
    return null;
  }
}

/** Put a fresh copy of the preset on each element (replacing its effect) and say what may need attention. */
export function applyEffectPreset(session: ProjectSession, nodeId: string, layerIds: string[], preset: EffectPreset): void {
  const scene = sceneOf(session, nodeId);
  if (!scene || !layerIds.length) return;
  updateScene(session, nodeId, tr('fxp.applyNamed', { name: preset.name }), (s: SceneData) => {
    for (const id of layerIds) { const l = s.layers.find((x) => x.id === id); if (l) l.effect = effectFromPreset(preset); }
  });
  const w = presetWarnings(session.project, preset, (type) => !!session.engine.effectNodes.get(type), scene.layers.map((l) => l.id));
  const notes: string[] = [];
  if (w.missingModules.length) notes.push(tr('fxp.needsModules', { modules: w.missingModules.join(', ') }));
  if (w.unknownNodes.length) notes.push(tr('fxp.unknownNodes', { nodes: w.unknownNodes.join(', ') }));
  if (w.missingVariables) notes.push(tr('fxp.pickVariable'));
  if (w.missingLayers) notes.push(tr('fxp.pickLayer'));
  if (notes.length) store.toast(`${tr('fxp.appliedNamed', { name: preset.name })}\n${notes.join('\n')}`, 'info');
  else store.toast(layerIds.length > 1 ? tr('fxp.appliedMany', { name: preset.name, n: layerIds.length }) : tr('fxp.appliedNamed', { name: preset.name }), 'success');
}

export async function importEffectPresets(): Promise<EffectPreset[]> {
  const paths = await store.pickFiles(tr('fxp.importTitle'), [{ name: tr('fxp.fileType'), extensions: [EFFECT_PRESET_EXT, 'json'] }]);
  if (!paths?.length) return [];
  const r: { imported: EffectPreset[]; errors: { path: string; message: string }[] } = await call('effectPresets.import', { paths });
  await loadEffectPresets(true);
  if (r.imported.length) store.toast(tr('fxp.imported', { n: r.imported.length }), 'success');
  for (const e of r.errors) store.toast(`${e.path.split(/[\\/]/).pop()}: ${e.message}`, 'error');
  return r.imported;
}

export async function exportEffectPreset(preset: EffectPreset): Promise<void> {
  const dir = await store.pickFolder(tr('fxp.exportTitle'));
  if (!dir) return;
  try {
    const r: { path: string } = await call('effectPresets.export', { id: preset.id, dir });
    store.toast(tr('fxp.exported', { path: r.path }), 'success', store.info?.nativeDialogs ? { label: tr('common.reveal'), run: () => call('shell.reveal', { path: r.path }) } : undefined);
  } catch (e: any) {
    store.toast(`${tr('fxp.exportFailed')}: ${e?.message || e}`, 'error');
  }
}

export async function deleteEffectPreset(preset: EffectPreset): Promise<void> {
  if (!(await store.confirm(tr('fxp.deleteTitle'), tr('fxp.deleteText', { name: preset.name }), tr('common.delete'), true))) return;
  await call('effectPresets.delete', { id: preset.id });
  await loadEffectPresets(true);
}

export async function renameEffectPreset(preset: EffectPreset, name: string): Promise<void> {
  name = name.trim();
  if (!name || name === preset.name) return;
  await call('effectPresets.save', { preset: { ...preset, name, graph: { ...preset.graph, name } } });
  await loadEffectPresets(true);
}

/* ------------------------------------------------------------------ */
/* Menus                                                                */
/* ------------------------------------------------------------------ */

/**
 * Menu for an element's ✦ button: built-in presets, the user's presets, and
 * preset actions. Applies to `layerIds` (the element, or every selected element).
 */
export function effectMenuItems(session: ProjectSession, nodeId: string, layerIds: string[], after?: () => void, withEdit = true): MenuItem[] {
  const mine = cache || [];
  if (!cache) loadEffectPresets();
  const first = sceneOf(session, nodeId)?.layers.find((l) => l.id === layerIds[0]);
  const applyBuiltIn = (make: () => any) => {
    updateScene(session, nodeId, tr('effects.add'), (s) => { for (const id of layerIds) { const l = s.layers.find((x) => x.id === id); if (l) l.effect = { kind: 'inline', graph: make() }; } });
    after?.();
  };
  const edit: MenuItem[] = withEdit && first?.effect ? [{ label: tr('effects.edit'), icon: 'wand', onClick: () => session.setSceneUI(nodeId, { selectedLayers: [first.id], effectsOpen: true }) }, { separator: true }] : [];
  return [
    ...edit,
    { label: tr('fxp.builtIn'), header: true },
    ...EFFECT_PRESETS.map((p) => ({ label: tr(p.label), icon: p.id === 'empty' ? 'plus' : 'sparkles', onClick: () => applyBuiltIn(p.make) })),
    { separator: true },
    { label: tr('fxp.mine'), header: true },
    ...(mine.length
      ? mine.map((p) => ({ label: p.name, icon: 'bookmark', hint: p.description, onClick: () => applyEffectPreset(session, nodeId, layerIds, p) }))
      : [{ label: tr('fxp.none'), disabled: true } as MenuItem]),
    { separator: true },
    ...(first?.effect ? [{ label: tr('fxp.saveCurrent'), icon: 'bookmarkPlus', onClick: () => saveEffectAsPreset(session, first) } as MenuItem] : []),
    { label: tr('fxp.importApply'), icon: 'upload', onClick: async () => { const got = await importEffectPresets(); if (got.length === 1) applyEffectPreset(session, nodeId, layerIds, got[0]); } },
    { label: tr('fxp.manage'), icon: 'library', onClick: () => openPresetManager(nodeId, layerIds) },
  ];
}

/* ------------------------------------------------------------------ */
/* Manager                                                              */
/* ------------------------------------------------------------------ */

export function EffectPresetManager({ session, nodeId, layerIds, onClose }: { session: ProjectSession; nodeId?: string; layerIds?: string[]; onClose: () => void }) {
  useStore();
  const t = useT();
  const list = useEffectPresets();
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const scene = nodeId ? sceneOf(session, nodeId) : null;
  const wanted = layerIds?.length ? layerIds : nodeId ? session.sceneUI(nodeId).selectedLayers : [];
  const targets = (scene?.layers || []).filter((l) => wanted.includes(l.id) && session.engine.layerTypes.get(l.type)?.visual);
  const shown = (list || []).filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));
  const cur = shown.find((p) => p.id === sel) || shown[0] || null;
  const source = targets.find((l) => l.effect);

  return (
    <Modal title={t('fxp.title')} icon={<Icon name="library" size={16} />} width={760} onClose={onClose} className="fxp-manager"
      footer={<>
        <Button icon="upload" onClick={async () => { const got = await importEffectPresets(); if (got[0]) setSel(got[0].id); }}>{t('fxp.import')}</Button>
        {source && <Button icon="bookmarkPlus" onClick={async () => { const p = await saveEffectAsPreset(session, source); if (p) setSel(p.id); }}>{t('fxp.saveFrom', { layer: source.name })}</Button>}
        <span className="grow" />
        <Button kind="primary" onClick={onClose}>{t('common.done')}</Button>
      </>}>
      <div className="fxp-body">
        <div className="fxp-list">
          <TextInput value={query} onChange={setQuery} placeholder={t('fxp.search')} live ariaLabel={t('fxp.search')} />
          {list === null && <div className="muted small pad">{'…'}</div>}
          {list && !list.length && <Empty icon="bookmark" title={t('fxp.emptyTitle')}>{t('fxp.emptyText')}</Empty>}
          {shown.map((p) => (
            <button key={p.id} type="button" className={cx('fxp-item', cur?.id === p.id && 'active')} onClick={() => setSel(p.id)}>
              <Icon name="bookmark" size={14} /><span className="nm">{p.name}</span>
              {p.requires.length > 0 && <Icon name="module" size={12} title={p.requires.join(', ')} />}
            </button>
          ))}
        </div>
        {cur && (
          <div className="fxp-detail">
            <TextInput key={cur.id} value={cur.name} onChange={(v) => renameEffectPreset(cur, v)} ariaLabel={t('fxp.name')} className="fxp-name" />
            <TextInput key={`${cur.id}-d`} value={cur.description || ''} multiline rows={2} placeholder={t('fxp.description')} ariaLabel={t('fxp.description')}
              onChange={async (v) => { await call('effectPresets.save', { preset: { ...cur, description: v } }); await loadEffectPresets(true); }} />
            <div className="fxp-meta">
              <span><Icon name="workflow" size={12} /> {t('fxp.nodes', { n: cur.graph.nodes.length })}</span>
              <span><Icon name="sliders" size={12} /> {cur.graph.params.length ? cur.graph.params.map((p) => p.name).join(', ') : t('fxp.noParams')}</span>
              {cur.requires.length > 0 && <span title={t('fxp.requiresHint')}><Icon name="module" size={12} /> {cur.requires.join(', ')}</span>}
              <span className="muted">{new Date(cur.savedAt).toLocaleString()}</span>
            </div>
            <div className="fxp-chain">
              {cur.graph.nodes.slice().sort((a, b) => a.x - b.x || a.y - b.y).map((n) => {
                const def = session.engine.effectNodes.get(n.type);
                return <span key={n.id} className={cx('chip', !def && 'missing')} title={def ? undefined : t('fxp.unknownNodes', { nodes: n.type })}>{def ? t(def.label) : n.type}</span>;
              })}
            </div>
            <div className="fxp-actions">
              <Button kind="primary" icon="sparkles" disabled={!targets.length} title={targets.length ? undefined : t('fxp.selectElements')}
                onClick={() => nodeId && applyEffectPreset(session, nodeId, targets.map((l) => l.id), cur)}>
                {targets.length === 1 ? t('fxp.applyTo', { layer: targets[0].name }) : targets.length > 1 ? t('fxp.applyToMany', { n: targets.length }) : t('fxp.apply')}
              </Button>
              <Button icon="download" onClick={() => exportEffectPreset(cur)}>{t('fxp.export')}</Button>
              <span className="grow" />
              <IconButton icon="trash" danger title={t('common.delete')} onClick={() => deleteEffectPreset(cur)} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
