/**
 * What a page shows besides its own elements (editor side): elements inherited from
 * earlier pages and the global page's elements, plus the operations that move
 * elements between a page and the global page.
 */
import type { Engine, Inheritance, Layer, PageContext, Project, SceneData } from '@vne/core';
import { GLOBAL_NODE_ID, ensureGlobalNode, pageContext } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store } from '../state/store';

const cache = new WeakMap<Project, { memo: Map<string, Inheritance>; pages: Map<string, PageContext> }>();

/** Inherited and global elements of a page (cached per project version). */
export function pageCtx(session: ProjectSession, nodeId: string): PageContext {
  return pageCtxOf(session.engine, session.project, nodeId);
}

export function pageCtxOf(engine: Engine, project: Project, nodeId: string): PageContext {
  let c = cache.get(project);
  if (!c) cache.set(project, (c = { memo: new Map(), pages: new Map() }));
  let r = c.pages.get(nodeId);
  if (!r) {
    try { r = pageContext(engine, project, nodeId, c.memo); }
    catch { r = { isGlobal: nodeId === GLOBAL_NODE_ID, inherited: [], inheritedScripts: [], globalBack: [], globalFront: [] }; }
    c.pages.set(nodeId, r);
  }
  return r;
}

export type ElementOrigin = 'own' | 'inherited' | 'global';

/** Every element a page's scripts can use, with where it comes from. */
export interface PageElement { layer: Layer; origin: ElementOrigin; from?: string; paused?: boolean }

export function pageElements(session: ProjectSession, nodeId: string): PageElement[] {
  return pageElementsOf(session.engine, session.project, nodeId);
}

export function pageElementsOf(engine: Engine, project: Project, nodeId: string): PageElement[] {
  const scene = project.nodes[nodeId]?.data as SceneData | undefined;
  const ctx = pageCtxOf(engine, project, nodeId);
  return [
    ...(scene?.layers || []).map((layer) => ({ layer, origin: 'own' as const })),
    ...ctx.inherited.map((e) => ({ layer: e.layer, origin: 'inherited' as const, from: e.fromNodeId, paused: e.paused })),
    ...[...ctx.globalBack, ...ctx.globalFront].map((layer) => ({ layer, origin: 'global' as const })),
  ];
}

/** Open the global page (optionally with an element selected). */
export function openGlobalPage(session: ProjectSession, layerId?: string): void {
  if (!session.project.nodes[GLOBAL_NODE_ID]) session.update(session.i18n.t('global.title'), (d) => { ensureGlobalNode(d); });
  session.openNode(GLOBAL_NODE_ID);
  if (layerId) session.setSceneUI(GLOBAL_NODE_ID, { selectedLayers: [layerId] });
}

/** Open the page an element comes from, with it selected. */
export function revealElement(session: ProjectSession, nodeId: string, layerId: string): void {
  session.openNode(nodeId);
  session.setSceneUI(nodeId, { selectedLayers: [layerId] });
}

/** The elements and everything inside them (groups). */
function withChildren(layers: Layer[], ids: string[]): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) { grew = false; for (const l of layers) if (l.parentId && out.has(l.parentId) && !out.has(l.id)) { out.add(l.id); grew = true; } }
  return out;
}

/**
 * Move elements from one page to another (a page ↔ the global page). Ids are kept, so
 * scripts that use them keep working. Animation tracks of moved elements are dropped
 * (animations belong to their page).
 */
export function moveElements(session: ProjectSession, fromId: string, toId: string, ids: string[]): void {
  const t = session.i18n.t;
  const from = session.project.nodes[fromId]?.data as SceneData | undefined;
  if (!from || !ids.length) return;
  const moving = withChildren(from.layers, ids);
  const dropped = from.animations.some((a) => a.tracks.some((tr) => moving.has(tr.layerId)) || a.media.some((m) => moving.has(m.layerId)));
  session.update(toId === GLOBAL_NODE_ID ? t('global.makeGlobal') : t('global.moveToPage'), (d) => {
    ensureGlobalNode(d);
    const src = d.nodes[fromId]?.data as SceneData;
    const dst = d.nodes[toId]?.data as SceneData;
    if (!src || !dst) return;
    const layers = src.layers.filter((l) => moving.has(l.id));
    src.layers = src.layers.filter((l) => !moving.has(l.id));
    for (const a of src.animations) { a.tracks = a.tracks.filter((tr) => !moving.has(tr.layerId)); a.media = a.media.filter((m) => !moving.has(m.layerId)); }
    for (const l of layers) if (l.parentId && !moving.has(l.parentId)) l.parentId = null;
    dst.layers.push(...layers);
  });
  session.setSceneUI(fromId, { selectedLayers: [] });
  store.toast(toId === GLOBAL_NODE_ID ? t('global.madeGlobal', { n: ids.length }) : t('global.movedToPage'), 'success');
  if (dropped) store.toast(t('global.animationsDropped'), 'info');
}

export function pageName(session: ProjectSession, nodeId: string | undefined): string {
  if (!nodeId) return '';
  if (nodeId === GLOBAL_NODE_ID) return session.i18n.t('global.title');
  return session.project.nodes[nodeId]?.name || '';
}
