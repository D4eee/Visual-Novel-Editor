/**
 * The user's preset library in the editor: scene presets (a group of chosen elements with
 * their animation and interactions) and character presets (a character with its rig,
 * motions and expressions). Entries live in the user data folder (host LibraryStore), so
 * every project can use them; their asset files are copied in and out.
 */
import { useEffect, useState } from 'react';
import type { Asset, Character, Composition, Layer, MediaClip, SceneData, ScriptStack, Track } from '@vne/core';
import { DIALOGUE_LAYER, createLayer, deepClone, effectGraphOf, newId, remapIds } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store } from '../state/store';
import { call } from '../host';
import { sceneImage } from '../ai/snapshot';
import { elementUsage, ensureClip, forEachBlock, sceneOf, updateScene } from '../scene/sceneOps';

export type LibraryKind = 'scene' | 'character';
export interface LibraryEntry<D = any> { id: string; kind: LibraryKind; name: string; savedAt: string; thumbnail?: string; data: D; assets: { id: string; name: string; kind: string; file: string }[] }

export interface ScenePresetData {
  v: 1;
  layers: Layer[];
  tracks: Track[];
  media: MediaClip[];
  spans: { layerId: string; in: number; out: number | null }[];
  duration: number;
  scripts: ScriptStack[];
  characters: Character[];
  compositions: Composition[];
  resolution: { width: number; height: number };
  /** The animation the tracks came from (interactions that play it play the scene's one instead). */
  clipId?: string | null;
}

/* ---------------------------------------------------------------- cache */

const cache: Partial<Record<LibraryKind, LibraryEntry[]>> = {};
const listeners = new Set<() => void>();
export async function reloadLibrary(kind: LibraryKind): Promise<LibraryEntry[]> {
  try { cache[kind] = (await call('library.list', { kind })) || []; } catch { cache[kind] = cache[kind] || []; }
  for (const l of listeners) l();
  return cache[kind]!;
}
export function useLibrary(kind: LibraryKind): LibraryEntry[] | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    if (!cache[kind]) reloadLibrary(kind);
    return () => { listeners.delete(l); };
  }, [kind]);
  return cache[kind] || null;
}

/* ---------------------------------------------------------------- helpers */

const assetIdsIn = (value: unknown, project: { assets: Asset[] }): Asset[] => {
  const json = JSON.stringify(value);
  return project.assets.filter((a) => json.includes(`"${a.id}"`));
};

const rewrite = <T,>(value: T, map: Record<string, string>): T => {
  const walk = (v: any): any => {
    if (typeof v === 'string') return map[v] ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(value);
};

const uniqueName = (base: string, taken: string[]) => {
  let n = 1;
  while (taken.includes(n === 1 ? base : `${base} ${n}`)) n++;
  return n === 1 ? base : `${base} ${n}`;
};

/** The chosen layers and everything inside the chosen groups, in scene order. */
export function withDescendants(scene: SceneData, ids: Iterable<string>): Set<string> {
  const all = new Set(ids);
  let grew = true;
  while (grew) { grew = false; for (const l of scene.layers) if (l.parentId && all.has(l.parentId) && !all.has(l.id)) { all.add(l.id); grew = true; } }
  return all;
}

/** Elements a scene preset can hold (the scene's single dialogue element stays). */
export const presetable = (l: Layer) => l.type !== DIALOGUE_LAYER;

/* ---------------------------------------------------------------- scene presets */

export async function saveScenePreset(session: ProjectSession, nodeId: string, layerIds: string[], name: string, replaceId?: string): Promise<LibraryEntry | null> {
  const t = session.i18n.t;
  const scene = sceneOf(session, nodeId);
  if (!scene) return null;
  const ids = withDescendants(scene, layerIds);
  const layers = deepClone(scene.layers.filter((l) => ids.has(l.id) && presetable(l)));
  for (const l of layers) {
    if (l.parentId && !ids.has(l.parentId)) l.parentId = null;
    if (l.link && !ids.has(l.link)) l.link = null;
    delete l.presetGroup;
    // Effects saved in the project's effect library travel with the element.
    if (l.effect && l.effect.kind !== 'inline') { const g = effectGraphOf(session.project, l.effect); l.effect = g ? { kind: 'inline', graph: deepClone(g) } as any : null; }
  }
  const ui = session.sceneUI(nodeId);
  const clip = scene.animations.find((a) => a.id === ui.clipId) || scene.animations[0] || null;
  const tracks = deepClone((clip?.tracks || []).filter((tr) => ids.has(tr.layerId)));
  const media = deepClone((clip?.media || []).filter((m) => ids.has(m.layerId)));
  const spans = Object.entries(clip?.spans || {}).filter(([id]) => ids.has(id)).map(([layerId, s]) => ({ layerId, in: s.in, out: s.out }));
  // Interactions started by these elements (other element references are cleared on load).
  const hats = elementUsage(session.engine, scene.scripts, ids).hatScripts;
  const scripts = deepClone(scene.scripts.filter((s) => hats.has(s.id)));
  const charIds = new Set(layers.map((l) => l.props.characterId).filter(Boolean));
  forEachBlock(scripts.flatMap((s) => [s.hat, ...s.body]), (b) => { for (const v of Object.values(b.args || {})) if (typeof v === 'string' && v.startsWith('chr_')) charIds.add(v); });
  const characters = deepClone(session.project.characters.filter((c) => charIds.has(c.id)));
  const compIds = new Set(layers.map((l) => l.props.compositionId).filter(Boolean));
  const compositions = deepClone((session.project.compositions || []).filter((c) => compIds.has(c.id)));
  const data: ScenePresetData = { v: 1, layers, tracks, media, spans, duration: clip?.duration || 0, scripts, characters, compositions, resolution: { ...session.project.settings.resolution }, clipId: clip?.id || null };
  let thumbnail: string | undefined;
  try { const img = await sceneImage(session, nodeId, { only: ids, max: 320, quality: 0.7, time: ui.time }); thumbnail = `data:image/jpeg;base64,${img.data}`; } catch { /* no picture */ }
  try {
    const entry = await call('library.save', { kind: 'scene', entry: { id: replaceId || newId('scp'), name, thumbnail, data }, path: session.path, assets: assetIdsIn(data, session.project) });
    await reloadLibrary('scene');
    store.toast(t('lib.sceneSaved', { name }), 'success');
    return entry;
  } catch (e: any) { store.toast(`${t('lib.saveFailed')}: ${e?.message || e}`, 'error'); return null; }
}

/** Bring an entry's files into the project; returns the asset id map (one history step for new assets). */
async function bringAssets(session: ProjectSession, kind: LibraryKind, id: string): Promise<{ entry: LibraryEntry; map: Record<string, string> } | null> {
  const t = session.i18n.t;
  try {
    const r = await call('library.load', { kind, id, path: session.path, existing: session.project.assets });
    if (r.assets.length) session.update(t('assets.import', { n: r.assets.length }), (d) => { d.assets.push(...r.assets); });
    if (r.errors?.length) store.toast(r.errors.join('\n'), 'error');
    return { entry: r.entry, map: r.map };
  } catch (e: any) { store.toast(`${t('lib.loadFailed')}: ${e?.message || e}`, 'error'); return null; }
}

/**
 * Characters of a preset: one with the same name in the project is used as it is (its
 * portraits, motions and expressions matched by name); others are added.
 */
function mergeCharacters(session: ProjectSession, list: Character[]): { map: Record<string, string>; add: Character[] } {
  const map: Record<string, string> = {};
  const add: Character[] = [];
  for (const c of list) {
    const same = session.project.characters.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (same) {
      map[c.id] = same.id;
      const byName = (a: { id: string; name: string }[] = [], b: { id: string; name: string }[] = []) => { for (const x of a) { const y = b.find((q) => q.name === x.name); if (y) map[x.id] = y.id; } };
      byName(c.portraits, same.portraits); byName(c.motions, same.motions); byName(c.expressions, same.expressions);
      continue;
    }
    const { value } = remapIds(c);
    const ids = collectIdMap(c, value);
    for (const [k, v] of ids) map[k] = v;
    fixExpressionKeys(value, ids);
    add.push(value);
  }
  return { map, add };
}

/** Old→new ids of two structurally equal values (after remapIds). */
function collectIdMap(a: any, b: any, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(a)) a.forEach((x, i) => collectIdMap(x, b?.[i], out));
  else if (a && typeof a === 'object') for (const k of Object.keys(a)) {
    if (k === 'id' && typeof a[k] === 'string' && typeof b?.[k] === 'string') out.set(a[k], b[k]);
    else collectIdMap(a[k], b?.[k], out);
  }
  return out;
}

/** Expressions keep their per-part and per-bone changes keyed by id: follow remapped ids. */
function fixExpressionKeys(ch: Character, map: Map<string, string>): void {
  for (const e of ch.expressions || []) {
    if (e.parts) e.parts = Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [map.get(k) || k, v]));
    if (e.bones) e.bones = Object.fromEntries(Object.entries(e.bones).map(([k, v]) => [map.get(k) || k, v]));
  }
}

/** The preset group(s) in a scene (made by loading a scene preset). */
export const presetGroups = (scene: SceneData) => scene.layers.filter((l) => l.type === 'core.group' && l.presetGroup);

/**
 * Load a scene preset into a scene as one group. `replace`: switch scenes — the scene's
 * existing preset groups (and their animation and interactions) are removed first and the
 * new group takes the place of the first one.
 */
export async function loadScenePreset(session: ProjectSession, nodeId: string, entryId: string, opts: { replace?: boolean } = {}): Promise<string | null> {
  const t = session.i18n.t;
  const got = await bringAssets(session, 'scene', entryId);
  if (!got) return null;
  const { entry } = got;
  let data = rewrite(entry.data as ScenePresetData, got.map);
  // Characters and compositions it uses.
  const chars = mergeCharacters(session, data.characters || []);
  const compMap: Record<string, string> = {};
  const compAdd: Composition[] = [];
  for (const c of data.compositions || []) {
    const same = (session.project.compositions || []).find((x) => x.id === c.id || x.name === c.name);
    if (same) { compMap[c.id] = same.id; continue; }
    const { value } = remapIds(c);
    compMap[c.id] = value.id;
    compAdd.push(value);
  }
  data = rewrite({ ...data, characters: [], compositions: [] }, { ...chars.map, ...compMap });
  // Fresh ids for the elements and everything that points at them.
  const spansAsList = data.spans || [];
  const { value: fresh } = remapIds({ layers: data.layers, tracks: data.tracks, media: data.media, scripts: data.scripts, spans: spansAsList.map((s) => ({ ...s })) }, ['id']);
  const oldToNew = collectIdMap(data.layers, fresh.layers);
  const spans = (fresh.spans as typeof spansAsList).map((s) => ({ ...s, layerId: oldToNew.get(s.layerId) || s.layerId }));
  // Scale to this project's resolution when the preset came from another size.
  const R = session.project.settings.resolution;
  const k = data.resolution && data.resolution.width && (data.resolution.width !== R.width || data.resolution.height !== R.height) ? Math.min(R.width / data.resolution.width, R.height / data.resolution.height) : 1;
  const group = createLayer(session.engine, session.project, 'core.group', entry.name, { x: 0, y: 0, ...(k !== 1 ? { scaleX: k, scaleY: k } : {}) });
  group.presetGroup = entry.id;
  const newLayerIds = new Set(fresh.layers.map((l: Layer) => l.id));
  for (const l of fresh.layers as Layer[]) if (!l.parentId || !newLayerIds.has(l.parentId)) l.parentId = group.id;
  // Interactions: element references outside the preset are cleared.
  for (const st of fresh.scripts as ScriptStack[]) forEachBlock([st.hat, ...st.body], (b) => {
    const def = session.engine.blocks.get(b.type);
    for (const arg of def?.args || []) if (arg.type === 'layer' && typeof b.args[arg.id] === 'string' && !newLayerIds.has(b.args[arg.id] as string)) b.args[arg.id] = null;
  });

  const scene = sceneOf(session, nodeId);
  if (!scene) return null;
  const old = opts.replace ? presetGroups(scene) : [];
  const removing = withDescendants(scene, old.map((l) => l.id));
  const oldHats = removing.size ? elementUsage(session.engine, scene.scripts, removing).hatScripts : new Set<string>();
  const animArgs: { b: any; id: string }[] = [];
  for (const st of fresh.scripts as ScriptStack[]) forEachBlock([st.hat, ...st.body], (b) => {
    const def = session.engine.blocks.get(b.type);
    for (const arg of def?.args || []) if (arg.type === 'animation' && b.args[arg.id]) animArgs.push({ b: b.args, id: arg.id });
  });
  const needsClip = fresh.tracks.length || fresh.media.length || spans.length || animArgs.length;
  updateScene(session, nodeId, t(opts.replace ? 'lib.switchHistory' : 'lib.loadHistory', { name: entry.name }), (s, d) => {
    if (chars.add.length) d.characters.push(...chars.add);
    if (compAdd.length) (d.compositions ||= []).push(...compAdd);
    // Where the group goes: the place of the group it replaces, else just above the backgrounds.
    let at = -1;
    if (old.length) at = s.layers.findIndex((l) => l.id === old[0].id);
    if (removing.size) {
      s.layers = s.layers.filter((l, i) => { if (removing.has(l.id)) { if (i < at) at--; return false; } return true; });
      if (at < 0) at = 0;
      for (const a of s.animations) { a.tracks = a.tracks.filter((tr) => !removing.has(tr.layerId)); a.media = a.media.filter((m) => !removing.has(m.layerId)); if (a.spans) for (const id of removing) delete a.spans[id]; }
      s.scripts = s.scripts.filter((st) => !oldHats.has(st.id));
    }
    if (at < 0) { at = 0; s.layers.forEach((l, i) => { if (l.type === 'core.background' && !l.parentId) at = i + 1; }); }
    s.layers.splice(at, 0, group, ...(fresh.layers as Layer[]));
    if (needsClip) {
      const clipId = ensureClip(session, nodeId, s);
      const clip = s.animations.find((a) => a.id === clipId)!;
      clip.tracks.push(...(fresh.tracks as Track[]));
      clip.media.push(...(fresh.media as MediaClip[]));
      if (spans.length) { clip.spans ||= {}; for (const sp of spans) clip.spans[sp.layerId] = { in: sp.in, out: sp.out }; }
      if (data.duration > clip.duration) clip.duration = data.duration;
      // Interactions that played the preset's animation play this one; others lose the reference.
      for (const a of animArgs) a.b[a.id] = s.animations.some((x) => x.id === a.b[a.id]) && a.b[a.id] !== data.clipId ? a.b[a.id] : clipId;
    }
    s.scripts.push(...(fresh.scripts as ScriptStack[]));
  });
  session.setSceneUI(nodeId, { selectedLayers: [group.id] });
  store.toast(t(opts.replace ? 'lib.switched' : 'lib.loaded', { name: entry.name }), 'success');
  return group.id;
}

/* ---------------------------------------------------------------- character presets */

export async function saveCharacterPreset(session: ProjectSession, characterId: string, replaceId?: string): Promise<LibraryEntry | null> {
  const t = session.i18n.t;
  const ch = session.project.characters.find((c) => c.id === characterId);
  if (!ch) return null;
  const thumbAsset = ch.portraits.find((p) => p.assetId)?.assetId || ch.rig?.parts.flatMap((p) => p.attachments).find((a) => a.assetId)?.assetId;
  let thumbnail: string | undefined;
  const asset = thumbAsset ? session.project.assets.find((a) => a.id === thumbAsset) : null;
  if (asset) {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = session.assetUrl(asset); });
      const c = document.createElement('canvas');
      const k = Math.min(1, 240 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      thumbnail = c.toDataURL('image/png');
      if (thumbnail.length > 300_000) thumbnail = c.toDataURL('image/jpeg', 0.75);
    } catch { /* no picture */ }
  }
  try {
    const entry = await call('library.save', { kind: 'character', entry: { id: replaceId || newId('chp'), name: ch.name, thumbnail, data: deepClone(ch) }, path: session.path, assets: assetIdsIn(ch, session.project) });
    await reloadLibrary('character');
    store.toast(t('lib.characterSaved', { name: ch.name }), 'success');
    return entry;
  } catch (e: any) { store.toast(`${t('lib.saveFailed')}: ${e?.message || e}`, 'error'); return null; }
}

/** Add a character preset to the project (a new character; the name is made unique). */
export async function addCharacterPreset(session: ProjectSession, entryId: string): Promise<string | null> {
  const t = session.i18n.t;
  const got = await bringAssets(session, 'character', entryId);
  if (!got) return null;
  const ch = rewrite(got.entry.data as Character, got.map);
  const { value } = remapIds(ch);
  value.name = uniqueName(ch.name, session.project.characters.map((c) => c.name));
  // Default motion follows the remapped motion ids.
  const idMap = collectIdMap(ch, value);
  fixExpressionKeys(value, idMap);
  if (ch.defaultMotion) value.defaultMotion = idMap.get(ch.defaultMotion) || null;
  session.update(t('lib.addCharacterHistory', { name: value.name }), (d) => { d.characters.push(value); });
  store.toast(t('lib.characterAdded', { name: value.name }), 'success');
  return value.id;
}

export async function deleteLibraryEntry(session: ProjectSession, entry: LibraryEntry): Promise<void> {
  const t = session.i18n.t;
  if (!(await store.confirm(t('lib.deleteTitle'), t('lib.deleteText', { name: entry.name }), t('common.delete'), true))) return;
  await call('library.delete', { kind: entry.kind, id: entry.id });
  await reloadLibrary(entry.kind);
}

export async function renameLibraryEntry(session: ProjectSession, entry: LibraryEntry): Promise<void> {
  const t = session.i18n.t;
  const name = (await store.prompt(t('lib.renameTitle'), t('lib.name'), entry.name))?.trim();
  if (!name || name === entry.name) return;
  await call('library.rename', { kind: entry.kind, id: entry.id, name });
  await reloadLibrary(entry.kind);
}
