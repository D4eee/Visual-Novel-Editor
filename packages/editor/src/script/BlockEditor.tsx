import { sceneChoices, sceneLines, hasSceneData } from '@vne/core';
import { useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import type { Block, BlockDef, Engine, Project, SceneData, StoryNode, Behavior } from '@vne/core';
import { newId, remapIds, isBlockRef } from '@vne/core';
import { Icon } from '../ui/Icon';
import { cx, IconButton, Toggle } from '../ui/controls';
import { openMenu, MenuItem } from '../ui/Menu';
import { ExprInput, ValueInput, ExprCtx } from './ExprInput';
import { pageElementsOf, pageCtxOf } from '../scene/pageContext';
import type { PageElement } from '../scene/pageContext';

export interface WStack { id: string; hat: Block | null; body: Block[]; enabled: boolean; x?: number; y?: number }

export const CATEGORY_COLORS: Record<string, string> = {
  elements: '#3d8bfd', events: '#d9a520', control: '#e8873a', looks: '#8b6cf0', sound: '#c75ec7', sensing: '#2fa9cf', variables: '#e0566b', story: '#4c8dff', operators: '#4fb35a', game: '#f07848', module: '#25a89c',
};

export function blockColor(def: BlockDef | undefined): string {
  if (!def) return '#5b6275';
  return def.color || CATEGORY_COLORS[def.category] || CATEGORY_COLORS.module;
}

export interface BlockCtx extends ExprCtx {
  engine: Engine;
  nodeId: string;
  /** For event nodes: layers/animations from every scene, since the action acts on the scene on screen. */
  storyLevel?: boolean;
}

export function newBlock(def: BlockDef): Block {
  const args: Record<string, any> = {};
  for (const a of def.args) args[a.id] = a.default ?? (a.type === 'number' ? 0 : a.type === 'boolean' ? false : a.type === 'string' || a.type === 'message' ? '' : null);
  const b: Block = { id: newId('blk'), type: def.id, args };
  if (def.shape === 'c' || def.shape === 'c-else') b.body = [];
  if (def.shape === 'c-else') b.else = [];
  return b;
}

/* ------------------------------------------------------------------ */
/* Tree helpers (work on drafts)                                       */
/* ------------------------------------------------------------------ */

type ListKey = string; // "<stackId>" | "<blockId>.body" | "<blockId>.else"

function findList(stacks: WStack[], key: ListKey): Block[] | null {
  for (const s of stacks) {
    if (s.id === key) return s.body;
    const r = findInBlocks(s.body, key);
    if (r) return r;
  }
  return null;
}

function findInBlocks(list: Block[], key: ListKey): Block[] | null {
  for (const b of list) {
    if (b.body && `${b.id}.body` === key) return b.body;
    if (b.else && `${b.id}.else` === key) return b.else;
    const r = (b.body && findInBlocks(b.body, key)) || (b.else && findInBlocks(b.else, key));
    if (r) return r;
  }
  return null;
}

function removeBlock(stacks: WStack[], blockId: string): Block | null {
  const rm = (list: Block[]): Block | null => {
    const i = list.findIndex((b) => b.id === blockId);
    if (i >= 0) return list.splice(i, 1)[0];
    for (const b of list) {
      const r = (b.body && rm(b.body)) || (b.else && rm(b.else));
      if (r) return r;
    }
    return null;
  };
  for (const s of stacks) { const r = rm(s.body); if (r) return r; }
  return null;
}

/** Reporter / boolean blocks placed in a block's slots. */
function slotBlocks(b: Block): { arg: string; block: Block }[] {
  const out: { arg: string; block: Block }[] = [];
  for (const [arg, v] of Object.entries(b.args || {})) if (isBlockRef(v)) out.push({ arg, block: v.block });
  return out;
}

/** Find a block anywhere: in scripts, inside C blocks and inside other blocks' slots. */
function findBlock(stacks: WStack[], blockId: string): Block | null {
  const inBlock = (b: Block): Block | null => {
    if (b.id === blockId) return b;
    for (const s of slotBlocks(b)) { const r = inBlock(s.block); if (r) return r; }
    return (b.body && f(b.body)) || (b.else && f(b.else)) || null;
  };
  const f = (list: Block[]): Block | null => {
    for (const b of list) { const r = inBlock(b); if (r) return r; }
    return null;
  };
  for (const s of stacks) {
    if (s.hat) { const r = inBlock(s.hat); if (r) return r; }
    const r = f(s.body);
    if (r) return r;
  }
  return null;
}

/** Take a reporter out of the slot it sits in (the slot gets its default value back). */
function detachFromSlot(stacks: WStack[], blockId: string, engine: Engine): Block | null {
  const visit = (b: Block): Block | null => {
    for (const s of slotBlocks(b)) {
      if (s.block.id === blockId) {
        const def = engine.blocks.get(b.type);
        const a = def?.args.find((x) => x.id === s.arg);
        b.args[s.arg] = a?.default ?? (a?.type === 'number' ? 0 : a?.type === 'boolean' ? false : null);
        return s.block;
      }
      const r = visit(s.block);
      if (r) return r;
    }
    for (const c of [...(b.body || []), ...(b.else || [])]) { const r = visit(c); if (r) return r; }
    return null;
  };
  for (const st of stacks) {
    for (const b of [...(st.hat ? [st.hat] : []), ...st.body]) { const r = visit(b); if (r) return r; }
  }
  return null;
}

/** True if `id` is the block itself or nested anywhere inside it. */
function containsBlock(b: Block, id: string): boolean {
  if (b.id === id) return true;
  return slotBlocks(b).some((s) => containsBlock(s.block, id)) || [...(b.body || []), ...(b.else || [])].some((c) => containsBlock(c, id));
}

/** Element ids a script refers to (any element slot, nested blocks included). */
export function stackElements(s: WStack, engine: Engine): Set<string> {
  const out = new Set<string>();
  const visit = (b: Block) => {
    const def = engine.blocks.get(b.type);
    for (const a of def?.args || []) if (a.type === 'layer' && typeof b.args[a.id] === 'string') out.add(b.args[a.id] as string);
    for (const x of slotBlocks(b)) visit(x.block);
    for (const c of [...(b.body || []), ...(b.else || [])]) visit(c);
  };
  if (s.hat) visit(s.hat);
  s.body.forEach(visit);
  return out;
}

const isValueShape = (d: BlockDef | undefined) => d?.shape === 'reporter' || d?.shape === 'boolean';
/** Blocks with no bottom connector: nothing can be attached after them. */
export const endsScript = (d: BlockDef | undefined) => d?.shape === 'cap' || !!d?.endsScript;

function contains(b: Block, key: ListKey): boolean {
  if (`${b.id}.body` === key || `${b.id}.else` === key) return true;
  return [...(b.body || []), ...(b.else || [])].some((c) => contains(c, key));
}

/* ------------------------------------------------------------------ */
/* Drag & drop                                                          */
/* ------------------------------------------------------------------ */

type DragState =
  | { kind: 'new'; def: BlockDef; args?: Record<string, any> }
  | { kind: 'move'; blockId: string; label: string; color: string; shape: string; ends?: boolean }
  | { kind: 'element'; layerId: string; label: string };
type DropTarget = { list: ListKey; index: number } | { newStack: true; x: number; y: number } | { slot: { blockId: string; arg: string } } | { value: { blockId: string; arg: string } } | { discard: true } | null;

const dragShape = (d: DragState): string => (d.kind === 'new' ? d.def.shape : d.kind === 'move' ? d.shape : 'element');
/** A dragged block that ends a script fits only at the end of a list (like Scratch's cap blocks). */
const dragEnds = (d: DragState): boolean => (d.kind === 'new' ? endsScript(d.def) : d.kind === 'move' ? !!d.ends : false);

function useBlockDrag(onDrop: (d: DragState, target: DropTarget) => void) {
  const [drag, setDrag] = useState<(DragState & { x: number; y: number; target: string | null }) | null>(null);
  const start = (e: React.PointerEvent, d: DragState) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, button:not(.blk-grab), .expr')) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    let target: DropTarget = null;
    const locate = (x: number, y: number): DropTarget => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      // Elements drop into element slots ("{layer}" arguments) of blocks.
      if (d.kind === 'element') {
        const slot = el?.closest('.blk-slot-layer') as HTMLElement | null;
        if (slot) return { slot: { blockId: slot.dataset.block!, arg: slot.dataset.arg! } };
        return el?.closest('.blk-workspace-drop') ? { newStack: true as const, x, y } : null;
      }
      // Reporters and conditions drop into value slots; boolean slots take conditions only.
      const shape = dragShape(d);
      if (shape === 'reporter' || shape === 'boolean') {
        const slot = el?.closest('.blk-slot-val') as HTMLElement | null;
        if (slot && (slot.dataset.accept !== 'boolean' || shape === 'boolean') && !(d.kind === 'move' && slot.closest(`[data-blk="${d.blockId}"]`))) return { value: { blockId: slot.dataset.block!, arg: slot.dataset.arg! } };
        return el?.closest('.blk-workspace-drop, .blk-palette') ? { discard: true as const } : null;
      }
      const fits = (g: HTMLElement) => !dragEnds(d) || g.dataset.end === '1';
      const gap = el?.closest('.blk-gap') as HTMLElement | null;
      if (gap && fits(gap)) return { list: gap.dataset.list!, index: Number(gap.dataset.index) };
      // nearest gap within the hovered list
      const list = el?.closest('.blk-list') as HTMLElement | null;
      if (list) {
        const gaps = [...list.querySelectorAll<HTMLElement>(':scope > .blk-gap')].filter(fits);
        let best: HTMLElement | null = null, bd = Infinity;
        for (const g of gaps) { const r = g.getBoundingClientRect(); const dd = Math.abs(r.top + r.height / 2 - y); if (dd < bd) { bd = dd; best = g; } }
        if (best) return { list: best.dataset.list!, index: Number(best.dataset.index) };
      }
      if (el?.closest('.blk-workspace-drop')) return { newStack: true as const, x, y };
      return null;
    };
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      active = true;
      target = locate(ev.clientX, ev.clientY);
      setDrag({ ...d, x: ev.clientX, y: ev.clientY, target: target ? ('list' in target ? `${target.list}:${target.index}` : 'slot' in target ? `slot:${target.slot.blockId}:${target.slot.arg}` : 'value' in target ? `val:${target.value.blockId}:${target.value.arg}` : 'discard' in target ? 'discard' : 'new') : null } as any);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-block');
      setDrag(null);
      if (active) onDrop(d, target);
      else if (d.kind !== 'move') onDrop(d, null); // click on palette = append
    };
    document.body.classList.add('dragging-block');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { drag, start };
}

/* ------------------------------------------------------------------ */
/* Workspace                                                            */
/* ------------------------------------------------------------------ */

/** Canvas position of a script; scripts without one are laid out in a grid. */
function stackPos(s: WStack, i: number): { x: number; y: number } {
  if (s.x || s.y) return { x: s.x || 0, y: s.y || 0 };
  return { x: 16 + (i % 3) * 360, y: 16 + Math.floor(i / 3) * 260 };
}

/** A free spot for a new script (below / beside the existing ones). */
function freeSpot(stacks: WStack[]): { x: number; y: number } {
  const n = stacks.length;
  return { x: 16 + (n % 3) * 360, y: 16 + Math.floor(n / 3) * 260 };
}

export function BlockWorkspace({ stacks, onChange, ctx, mode, selectedStack, onSelectStack, header, running, selectedLayer, onSelectLayer, onNewElement, categoryExtra, onOpenElement }: {
  stacks: WStack[];
  /** Extra palette content shown above a category's blocks (the Game category's variable manager). */
  categoryExtra?: (category: string, api: { dragElement(e: React.PointerEvent, layerId: string, label: string): void; dragBlock(e: React.PointerEvent, defId: string, args: Record<string, any>): void }) => ReactNode;
  /** Double-click on an element in the palette (opens its element-variable editor). */
  onOpenElement?: (layerId: string) => void;
  /** Scene scripts: the element selected in the scene (its blocks open in the palette, its scripts are marked). */
  selectedLayer?: string | null;
  onSelectLayer?: (id: string) => void;
  /** Scene scripts: menu for creating elements (media, text, shape, button, detection area, choice) from here. */
  onNewElement?: (e: React.MouseEvent) => void;
  /** Ids of blocks that ran a moment ago (test runs). */
  running?: Set<string>;
  onChange: (recipe: (draft: WStack[]) => void, label: string) => void;
  ctx: BlockCtx;
  mode: 'scene' | 'story';
  selectedStack?: string | null;
  onSelectStack?: (id: string | null) => void;
  header?: ReactNode;
}) {
  const t = ctx.t;
  const engine = ctx.engine;
  const canvas = mode === 'scene';
  const scene = canvas ? (ctx.project.nodes[ctx.nodeId]?.data as SceneData | undefined) : undefined;
  // This page's elements, those it inherits from earlier pages, and the global page's.
  const allElements: PageElement[] = canvas ? pageElementsOf(engine, ctx.project, ctx.nodeId).filter((e) => e.layer.type !== 'core.dialogue') : [];
  const elementGroups: { origin: PageElement['origin']; items: PageElement[] }[] = (['own', 'inherited', 'global'] as const)
    .map((origin) => ({ origin, items: allElements.filter((e) => e.origin === origin).reverse() }))
    .filter((g) => g.origin === 'own' || g.items.length);
  const [category, setCategory] = useState<string>(mode === 'scene' ? 'elements' : 'looks');
  const [expanded, setExpanded] = useState<string | null>(selectedLayer || null);
  // Selecting an element in the scene opens its blocks here.
  useEffect(() => { if (selectedLayer) { setExpanded(selectedLayer); if (canvas) setCategory((c) => (c === 'game' ? c : 'elements')); } }, [selectedLayer]);
  const refsSelected = useMemo(() => new Set(selectedLayer ? stacks.filter((s) => stackElements(s, engine).has(selectedLayer)).map((s) => s.id) : []), [stacks, selectedLayer, engine]);
  /** Blocks offered under an element, with the element already filled in. */
  const elementBlocks = (l: { id: string; type: string }): { def: BlockDef; args: Record<string, any> }[] => {
    const visual = engine.layerTypes.get(l.type)?.visual !== false;
    const out: { def: BlockDef; args: Record<string, any> }[] = [];
    for (const d of engine.blocks.list()) {
      if (d.context === 'story') continue;
      const arg = d.args.find((a) => a.type === 'layer');
      if (!arg) continue;
      const types = d.layerTypes;
      const ok = types ? types.includes('*') || types.includes(l.type) : visual;
      if (!ok || (arg.layerTypes && !arg.layerTypes.includes(l.type))) continue;
      out.push({ def: d, args: { [arg.id]: l.id } });
    }
    const rank: Record<string, number> = { hat: 0, statement: 1, c: 1, 'c-else': 1, cap: 1, boolean: 2, reporter: 3 };
    return out.sort((a, b) => (rank[a.def.shape] ?? 9) - (rank[b.def.shape] ?? 9));
  };
  // Canvas view (scene scripts): wheel zooms, dragging empty space pans.
  const [view, setView] = useState({ x: 16, y: 16, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const wsRef = useRef<HTMLDivElement>(null);
  const toWorld = (cx: number, cy: number) => {
    const r = wsRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return r ? { x: Math.round((cx - r.left - v.x) / v.zoom), y: Math.round((cy - r.top - v.y) / v.zoom) } : { x: 0, y: 0 };
  };
  useEffect(() => {
    const el = wsRef.current;
    if (!el || !canvas) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const r = el.getBoundingClientRect();
      const zoom = Math.max(0.3, Math.min(2, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView({ zoom, x: mx - ((mx - v.x) / v.zoom) * zoom, y: my - ((my - v.y) / v.zoom) * zoom });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [canvas]);
  const panStart = (e: React.PointerEvent) => {
    if (!canvas || e.button !== 0 || (e.target as HTMLElement) !== e.currentTarget && !(e.target as HTMLElement).classList.contains('blk-world')) return;
    const sx = e.clientX, sy = e.clientY, v0 = viewRef.current;
    const move = (ev: PointerEvent) => setView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('panning'); };
    document.body.classList.add('panning');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Drag a script by its trigger block to place it on the canvas.
  const stackMoveStart = (e: React.PointerEvent, st: WStack, pos: { x: number; y: number }) => {
    if (!canvas || e.button !== 0 || (e.target as HTMLElement).closest('input, select, textarea, button, .expr, .blk-slot-layer')) return;
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const el = (e.currentTarget as HTMLElement).closest('.blk-stack') as HTMLElement | null;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / viewRef.current.zoom, dy = (ev.clientY - sy) / viewRef.current.zoom;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (el) el.style.transform = '';
      if (!moved) return;
      const nx = Math.round(pos.x + (ev.clientX - sx) / viewRef.current.zoom), ny = Math.round(pos.y + (ev.clientY - sy) / viewRef.current.zoom);
      onChange((draft) => { const x = draft.find((y) => y.id === st.id); if (x) { x.x = nx; x.y = ny; } }, t('script.moveScript'));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [query, setQuery] = useState('');
  const defs = useMemo(() => engine.blocks.list().filter((d) => (mode === 'scene' ? d.context !== 'story' : d.shape !== 'hat' && d.context !== 'scene' ? true : d.shape !== 'hat' && mode === 'story' && d.context === 'scene' ? false : d.shape !== 'hat')), [engine, mode, engine.blocks.list().length]);
  const usable = defs.filter((d) => (mode === 'story' ? d.shape !== 'hat' && d.context !== 'scene' : true));
  const categories = [...new Set([...(canvas ? ['elements'] : []), ...usable.map((d) => d.category)])];
  const order = ['elements', 'events', 'control', 'looks', 'game', 'sound', 'sensing', 'operators', 'variables', 'story'];
  categories.sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  const shown = usable.filter((d) => (query ? t(d.label).toLowerCase().includes(query.toLowerCase()) || d.id.toLowerCase().includes(query.toLowerCase()) : d.category === category));

  const targetStack = selectedStack && stacks.some((s) => s.id === selectedStack) ? selectedStack : stacks[stacks.length - 1]?.id;

  const { drag, start } = useBlockDrag((d, target) => {
    const at = target && 'newStack' in target ? toWorld(target.x, target.y) : freeSpot(stacks);
    // Reporters / conditions: into a value slot, out of one, or away.
    if (dragShape(d) === 'reporter' || dragShape(d) === 'boolean') {
      if (d.kind === 'new') {
        if (!target || !('value' in target)) return;
        const r = newBlock(d.def);
        Object.assign(r.args, d.args || {});
        onChange((draft) => { const b = findBlock(draft, target.value.blockId); if (b) b.args[target.value.arg] = { k: 'block', block: r }; }, t('script.addBlock'));
        return;
      }
      if (d.kind !== 'move' || !target) return;
      onChange((draft) => {
        const inner = detachFromSlot(draft, d.blockId, engine);
        if (!inner || !('value' in target)) return; // dropped elsewhere: removed
        const host = findBlock(draft, target.value.blockId);
        if (host && !containsBlock(inner, host.id)) host.args[target.value.arg] = { k: 'block', block: inner };
      }, 'value' in target ? t('script.moveBlock') : t('script.deleteBlock'));
      return;
    }
    if (d.kind === 'element') {
      if (target && 'slot' in target) { ops.setArg(target.slot.blockId, target.slot.arg, d.layerId); return; }
      // A click selects the element (in the scene too) and opens its blocks.
      if (!target) { setExpanded((x) => (x === d.layerId && selectedLayer === d.layerId ? null : d.layerId)); onSelectLayer?.(d.layerId); return; }
      // Dropped on the canvas: a new script that reacts to this element.
      const hatDef = engine.blocks.get('core.whenLayerClicked');
      if (!hatDef || mode !== 'scene') return;
      const hat = newBlock(hatDef);
      hat.args.layer = d.layerId;
      const id = newId('scr');
      onChange((draft) => { draft.push({ id, hat, body: [], enabled: true, x: at.x, y: at.y }); }, t('script.addScript'));
      onSelectStack?.(id);
      return;
    }
    if (d.kind === 'new') {
      const def = d.def;
      if (def.shape === 'hat') {
        if (mode !== 'scene') return;
        const id = newId('scr');
        const hat = newBlock(def);
        Object.assign(hat.args, d.args || {});
        onChange((draft) => { draft.push({ id, hat, body: [], enabled: true, x: at.x, y: at.y }); }, t('script.addScript'));
        onSelectStack?.(id);
        return;
      }
      const block = newBlock(def);
      Object.assign(block.args, d.args || {});
      if (target && 'list' in target) onChange((draft) => { findList(draft, target.list)?.splice(target.index, 0, block); }, t('script.addBlock'));
      else if (target && 'newStack' in target && mode === 'scene') {
        // statements need a trigger: start a new script that runs when the scene starts
        const hat = engine.blocks.get('core.whenSceneStarts');
        if (hat) onChange((draft) => { draft.push({ id: newId('scr'), hat: newBlock(hat), body: [block], enabled: true, x: at.x, y: at.y }); }, t('script.addScript'));
      } else if (targetStack) onChange((draft) => { draft.find((s) => s.id === targetStack)?.body.push(block); }, t('script.addBlock'));
      else if (mode === 'scene') {
        const hat = engine.blocks.get('core.whenSceneStarts');
        if (hat) onChange((draft) => { draft.push({ id: newId('scr'), hat: newBlock(hat), body: [block], enabled: true }); }, t('script.addScript'));
      }
      return;
    }
    if (!target || !('list' in target)) return;
    onChange((draft) => {
      const b = findBlock(draft, d.blockId);
      if (!b || contains(b, target.list)) return; // cannot drop into itself
      // index correction when moving down within the same list
      const srcList = draft.map((s) => s.body).find((l) => l.some((x) => x.id === d.blockId)) || null;
      let idx = target.index;
      const list = findList(draft, target.list);
      if (!list) return;
      const cur = list.findIndex((x) => x.id === d.blockId);
      if (cur >= 0 && cur < idx) idx--;
      void srcList;
      const removed = removeBlock(draft, d.blockId);
      if (removed) findList(draft, target.list)?.splice(idx, 0, removed);
    }, t('script.moveBlock'));
  });

  const ops: BlockOps = {
    ctx,
    running,
    drag,
    startMove: (e, b) => { const def = engine.blocks.get(b.type); start(e, { kind: 'move', blockId: b.id, label: t(def?.label || b.type), color: blockColor(def), shape: def?.shape || 'statement', ends: endsScript(def) }); },
    setArg: (blockId, arg, value) => onChange((draft) => { const b = findBlock(draft, blockId); if (b) b.args[arg] = value; }, t('script.editBlock')),
    remove: (blockId) => onChange((draft) => { if (!removeBlock(draft, blockId)) detachFromSlot(draft, blockId, engine); }, t('script.deleteBlock')),
    duplicate: (blockId) => onChange((draft) => {
      const b = findBlock(draft, blockId);
      if (!b) return;
      const copy = remapIds(JSON.parse(JSON.stringify(b))).value as Block;
      for (const s of draft) {
        const place = (list: Block[]): boolean => {
          const i = list.findIndex((x) => x.id === blockId);
          if (i >= 0) { list.splice(i + 1, 0, copy); return true; }
          return list.some((x) => (x.body && place(x.body)) || (x.else && place(x.else)));
        };
        if (place(s.body)) return;
      }
    }, t('script.duplicateBlock')),
  };

  return (
    <div className="blk-editor">
      <aside className="blk-palette" aria-label={t('script.palette')}>
        <div className="blk-search"><Icon name="search" size={14} /><input placeholder={t('script.searchBlocks')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
        {!query && (
          <div className="blk-cats">
            {categories.map((c) => (
              <button key={c} type="button" className={cx('blk-cat', c === category && 'active')} onClick={() => setCategory(c)}>
                <span className="dot" style={{ background: CATEGORY_COLORS[c] || CATEGORY_COLORS.module }} />
                {t(`block.cat.${c}`)}
              </button>
            ))}
          </div>
        )}
        <div className="blk-palette-list">
          {canvas && !query && category === 'elements' && (
            <div className="blk-elements">
              {onNewElement && <button type="button" className="blk-new-el" onClick={onNewElement} title={t('script.newElementHint')}><Icon name="plus" size={13} />{t('script.newElement')}</button>}
              {elementGroups.map((g) => (
                <div key={g.origin} className="blk-el-group">
                  {g.origin !== 'own' && <div className="blk-el-group-head" title={t(g.origin === 'global' ? 'global.sectionHint' : 'inherit.sectionHint')}><Icon name={g.origin === 'global' ? 'globe' : 'inherit'} size={11} />{t(g.origin === 'global' ? 'global.section' : 'inherit.section')}</div>}
                  {g.items.map(({ layer: l, origin, paused }) => {
                    const ldef = engine.layerTypes.get(l.type);
                    const open = expanded === l.id;
                    return (
                      <div key={l.id} className={cx('blk-element', open && 'open', selectedLayer === l.id && 'selected', origin !== 'own' && 'context')}>
                        <div className="blk-element-row">
                          <button type="button" className="blk-el-toggle" aria-expanded={open} aria-label={t('script.elementBlocks', { name: l.name })} onClick={() => setExpanded(open ? null : l.id)}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></button>
                          <span className="blk-pill" onPointerDown={(e) => start(e, { kind: 'element', layerId: l.id, label: l.name })} onDoubleClick={() => onOpenElement?.(l.id)} title={t('script.elementHint')}>
                            <Icon name={ldef?.icon || 'layers'} size={12} /><span className="nm">{l.name}</span>
                          </span>
                          {paused && <Icon name="paused" size={12} title={t('inherit.paused')} />}
                          {!l.visible && <Icon name="eyeOff" size={12} title={t('script.startsHidden')} />}
                        </div>
                        {open && (
                          <div className="blk-element-blocks">
                            {elementBlocks(l).map(({ def, args }) => <PaletteBlock key={def.id} def={def} args={args} ctx={ctx} onPointerDown={(e) => start(e, { kind: 'new', def, args })} />)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {g.origin === 'own' && !g.items.length && <div className="muted small pad">{t('script.noElements')}</div>}
                </div>
              ))}
            </div>
          )}
          {!query && categoryExtra?.(category, {
            dragElement: (e, layerId, label) => start(e, { kind: 'element', layerId, label }),
            dragBlock: (e, defId, args) => { const def = engine.blocks.get(defId); if (def) start(e, { kind: 'new', def, args }); },
          })}
          {!query && category === 'variables' && (
            <div className="blk-elements">
              {[...ctx.project.variables, ...(scene?.localVariables || [])].map((v) => {
                const def = engine.blocks.get('core.varValue');
                return def ? <PaletteBlock key={v.id} def={def} args={{ variable: v.id }} ctx={ctx} onPointerDown={(e) => start(e, { kind: 'new', def, args: { variable: v.id } })} /> : null;
              })}
            </div>
          )}
          {shown.filter((d) => !(category === 'variables' && d.id === 'core.varValue' && !query)).map((d) => (
            <PaletteBlock key={d.id} def={d} ctx={ctx} onPointerDown={(e) => start(e, { kind: 'new', def: d })} />
          ))}
          {!shown.length && <div className="muted small pad">{t('common.noResults')}</div>}
        </div>
      </aside>
      <div className="blk-main">
        {header}
        <div className={cx('blk-workspace blk-workspace-drop', canvas && 'canvas')} ref={wsRef} onPointerDown={panStart}
          style={canvas ? { backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${18 * view.zoom}px ${18 * view.zoom}px` } : undefined}>
          <div className="blk-world" style={canvas ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` } : undefined} onPointerDown={canvas ? panStart : undefined}>
          {stacks.map((s, i) => {
            const pos = stackPos(s, i);
            return (
            <div key={s.id} className={cx('blk-stack', s.id === targetStack && 'targeted', !s.enabled && 'disabled', refsSelected.has(s.id) && 'refs-selected')} onPointerDown={() => onSelectStack?.(s.id)}
              style={canvas ? { left: pos.x, top: pos.y } : undefined}>
              {s.hat && (
                <div className={cx('blk shape-hat', running?.has(s.hat.id) && 'running')} style={{ ['--blk' as any]: blockColor(engine.blocks.get(s.hat.type)) }} onPointerDown={(e) => stackMoveStart(e, s, pos)}>
                  <BlockLabel def={engine.blocks.get(s.hat.type)} block={s.hat} ops={ops} />
                  <div className="blk-tools">
                    <Toggle value={s.enabled} onChange={(v) => onChange((draft) => { const x = draft.find((y) => y.id === s.id); if (x) x.enabled = v; }, t('script.toggleScript'))} title={t('script.enabled')} />
                    <IconButton icon="more" size={14} title={t('common.more')} onClick={(e) => openMenu(e, [
                      { label: t('script.duplicateScript'), icon: 'duplicate', onClick: () => onChange((draft) => { const x = draft.find((y) => y.id === s.id); if (x) { const c = remapIds(JSON.parse(JSON.stringify(x))).value as WStack; c.x = pos.x + 30; c.y = pos.y + 30; draft.push(c); } }, t('script.duplicateScript')) },
                      { label: t('script.changeTrigger'), icon: 'bolt', submenu: engine.blocks.list().filter((d) => d.shape === 'hat').map((d) => ({ label: t(d.label).replace(/\{\w+\}/g, '…'), onClick: () => onChange((draft) => { const x = draft.find((y) => y.id === s.id); if (x) x.hat = newBlock(d); }, t('script.changeTrigger')) })) },
                      { separator: true },
                      { label: t('script.deleteScript'), icon: 'trash', danger: true, onClick: () => onChange((draft) => { const i = draft.findIndex((y) => y.id === s.id); if (i >= 0) draft.splice(i, 1); }, t('script.deleteScript')) },
                    ])} />
                  </div>
                </div>
              )}
              <BlockList list={s.body} listKey={s.id} ops={ops} />
            </div>
            );
          })}
          </div>
          {!stacks.length && (
            <div className="blk-empty" title={mode === 'scene' ? t('script.emptyScene') : t('script.emptyActions')}>
              <Icon name="script" size={26} />
            </div>
          )}
        </div>
      </div>
      {drag && (
        <div className={cx('blk-ghost', drag.kind === 'element' && 'pill')} style={{ left: drag.x + 10, top: drag.y + 6, ['--blk' as any]: drag.kind === 'new' ? blockColor(drag.def) : drag.kind === 'move' ? drag.color : '#3d8bfd' }}>
          {drag.kind === 'new' ? t(drag.def.label).replace(/\{\w+\}/g, '…') : drag.label.replace(/\{\w+\}/g, '…')}
        </div>
      )}
    </div>
  );
}

interface BlockOps {
  ctx: BlockCtx;
  running?: Set<string>;
  drag: { target: string | null } | null;
  startMove(e: React.PointerEvent, b: Block): void;
  setArg(blockId: string, arg: string, value: any): void;
  remove(blockId: string): void;
  duplicate(blockId: string): void;
}

function BlockList({ list, listKey, ops }: { list: Block[]; listKey: string; ops: BlockOps }) {
  // A block that ends the script (stop, go to scene, forever…) has no bottom connector:
  // there is no drop gap after it, and blocks that end a script only fit at the very end.
  const closed = list.length > 0 && endsScript(ops.ctx.engine.blocks.get(list[list.length - 1].type));
  const gap = (i: number) => <div key={`g${i}`} className={cx('blk-gap', ops.drag?.target === `${listKey}:${i}` && 'hot')} data-list={listKey} data-index={i} data-end={i === list.length && !closed ? '1' : undefined} />;
  const items: ReactNode[] = [gap(0)];
  list.forEach((b, i) => {
    items.push(<BlockView key={b.id} block={b} ops={ops} />);
    if (!(closed && i === list.length - 1)) items.push(gap(i + 1));
  });
  return <div className={cx('blk-list', !list.length && 'empty')}>{items}</div>;
}

function BlockView({ block, ops }: { block: Block; ops: BlockOps }) {
  const def = ops.ctx.engine.blocks.get(block.type);
  const t = ops.ctx.t;
  if (!def) {
    return (
      <div className="blk shape-statement missing" onPointerDown={(e) => ops.startMove(e, block)}>
        <Icon name="warning" size={14} /> <span>{t('script.missingBlock', { type: block.type })}</span>
        <IconButton icon="trash" size={13} title={t('common.delete')} onClick={() => ops.remove(block.id)} />
      </div>
    );
  }
  const color = blockColor(def);
  const ctxMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e, [
      { label: t('common.duplicate'), icon: 'duplicate', onClick: () => ops.duplicate(block.id) },
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => ops.remove(block.id) },
    ]);
  };
  return (
    <div className={cx('blk-wrap', `shape-${def.shape}`, endsScript(def) && 'ends')}>
      <div className={cx('blk', `shape-${def.shape}`, endsScript(def) && 'ends', ops.running?.has(block.id) && 'running')} style={{ ['--blk' as any]: color }} onPointerDown={(e) => ops.startMove(e, block)} onContextMenu={ctxMenu}
        onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === e.currentTarget) { e.stopPropagation(); ops.remove(block.id); } }} tabIndex={0}>
        <BlockLabel def={def} block={block} ops={ops} />
        <IconButton icon="close" size={12} className="blk-del" title={t('common.delete')} onClick={() => ops.remove(block.id)} />
      </div>
      {(def.shape === 'c' || def.shape === 'c-else') && (
        <div className="blk-c" style={{ ['--blk' as any]: color }}>
          <div className="blk-c-body"><BlockList list={block.body || []} listKey={`${block.id}.body`} ops={ops} /></div>
          {def.shape === 'c-else' && (
            <>
              <div className="blk-c-label">{t('block.else')}</div>
              <div className="blk-c-body"><BlockList list={block.else || []} listKey={`${block.id}.else`} ops={ops} /></div>
            </>
          )}
          <div className="blk-c-foot" />
        </div>
      )}
    </div>
  );
}

/** Renders a label template like "play {anim} and wait {wait}" with argument editors in place of {placeholders}. */
function BlockLabel({ def, block, ops }: { def: BlockDef | undefined; block: Block | null; ops: BlockOps | null }) {
  if (!def) return <span>?</span>;
  const t = ops?.ctx.t || ((k: string) => k);
  const label = ops ? t(def.label) : (globalThis as any).__vneT?.(def.label) || def.label;
  const parts = label.split(/(\{\w+\})/g).filter(Boolean);
  return (
    <span className="blk-label">
      {parts.map((part: string, i: number) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return <span key={i} className="blk-text">{part}</span>;
        const arg = def.args.find((a) => a.id === m[1]);
        if (!arg) return <span key={i}>{part}</span>;
        if (!block || !ops) return <span key={i} className={cx('blk-slot', `t-${arg.type}`)}>{arg.type === 'boolean' ? '☐' : arg.type === 'layer' ? '◉' : arg.type === 'expr' || arg.type === 'number' || arg.type === 'string' ? '' : '…'}</span>;
        const value = block.args[arg.id];
        // Value slots take reporter / condition blocks (Scratch-style); a placed block replaces the field.
        if (VALUE_SLOTS.has(arg.type)) {
          const accept = arg.type === 'boolean' ? 'boolean' : 'any';
          const hot = ops.drag?.target === `val:${block.id}:${arg.id}`;
          return (
            <span key={i} className={cx('blk-slot-val', `accept-${accept}`, hot && 'hot', isBlockRef(value) && 'filled')} data-block={block.id} data-arg={arg.id} data-accept={accept}>
              {isBlockRef(value)
                ? <ValueBlockView block={value.block} ops={ops} />
                : <ArgEditor arg={arg} value={value} onChange={(v) => ops.setArg(block.id, arg.id, v)} ctx={ops.ctx} block={block} />}
            </span>
          );
        }
        const editor = <ArgEditor key={i} arg={arg} value={value} onChange={(v) => ops.setArg(block.id, arg.id, v)} ctx={ops.ctx} block={block} />;
        // Element slots accept elements dragged from the palette.
        return arg.type === 'layer'
          ? <span key={i} className={cx('blk-slot-layer', ops.drag?.target === `slot:${block.id}:${arg.id}` && 'hot')} data-block={block.id} data-arg={arg.id}>{editor}</span>
          : editor;
      })}
    </span>
  );
}

const VALUE_SLOTS = new Set(['expr', 'number', 'string', 'boolean']);

/** A reporter or condition sitting in a slot: drag it out to move or remove it. */
function ValueBlockView({ block, ops }: { block: Block; ops: BlockOps }) {
  const def = ops.ctx.engine.blocks.get(block.type);
  const t = ops.ctx.t;
  if (!def) return <span className="blk nested shape-reporter missing" data-blk={block.id} onPointerDown={(e) => ops.startMove(e, block)}><Icon name="warning" size={12} /> {block.type}</span>;
  return (
    <span className={cx('blk nested', `shape-${def.shape}`, ops.running?.has(block.id) && 'running')} data-blk={block.id} style={{ ['--blk' as any]: blockColor(def) }}
      onPointerDown={(e) => ops.startMove(e, block)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(e, [{ label: t('common.delete'), icon: 'trash', danger: true, onClick: () => ops.remove(block.id) }]); }}>
      <BlockLabel def={def} block={block} ops={ops} />
    </span>
  );
}

/** A block in the palette; `args` pre-fills slots (e.g. the element it belongs to), shown by name. */
function PaletteBlock({ def, args, ctx, onPointerDown }: { def: BlockDef; args?: Record<string, any>; ctx: BlockCtx; onPointerDown: (e: React.PointerEvent) => void }) {
  const t = ctx.t;
  const label = t(def.label);
  const name = (arg: BlockDef['args'][number], v: any): string | null => {
    if (v == null) return null;
    if (arg.type === 'layer') for (const n of Object.values(ctx.project.nodes)) { const l = (n.data as any)?.layers?.find?.((x: any) => x.id === v); if (l) return l.name; }
    if (arg.type === 'variable') return ctx.project.variables.find((x) => x.id === v)?.name || (ctx.project.nodes[ctx.nodeId]?.data as any)?.localVariables?.find?.((x: any) => x.id === v)?.name || null;
    if (arg.type === 'item') return ctx.project.items.find((x) => x.id === v)?.name || String(v);
    return null;
  };
  return (
    <div className={cx('blk-wrap palette', `shape-${def.shape}`, endsScript(def) && 'ends')}>
    <div className={cx('blk', `shape-${def.shape}`, endsScript(def) && 'ends', 'palette')} style={{ ['--blk' as any]: blockColor(def) }} onPointerDown={onPointerDown}
      title={def.shape === 'reporter' || def.shape === 'boolean' ? t('script.dragIntoSlot') : t('script.dragOrClick')}>
      <span className="blk-label">
        {label.split(/(\{\w+\})/g).filter(Boolean).map((part: string, i: number) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (!m) return <span key={i} className="blk-text">{part}</span>;
          const arg = def.args.find((a) => a.id === m[1]);
          if (!arg) return <span key={i}>{part}</span>;
          const preset = args && args[arg.id] !== undefined ? name(arg, args[arg.id]) : null;
          if (preset) return <span key={i} className={cx('blk-slot filled', `t-${arg.type}`)}>{preset}</span>;
          return <span key={i} className={cx('blk-slot', `t-${arg.type}`)}>{arg.type === 'boolean' ? '' : arg.type === 'layer' ? '◉' : ''}</span>;
        })}
      </span>
    </div>
    {(def.shape === 'c' || def.shape === 'c-else') && (
      <div className="blk-c" style={{ ['--blk' as any]: blockColor(def) }} onPointerDown={onPointerDown}>
        <div className="blk-c-body"><div className="blk-list empty" /></div>
        {def.shape === 'c-else' && <><div className="blk-c-label">{t('block.else')}</div><div className="blk-c-body"><div className="blk-list empty" /></div></>}
        <div className="blk-c-foot" />
      </div>
    )}
    </div>
  );
}

function scenesForCtx(ctx: BlockCtx): { node: StoryNode; scene: SceneData }[] {
  const node = ctx.project.nodes[ctx.nodeId];
  if (hasSceneData(node) && !ctx.storyLevel) return [{ node, scene: node.data as SceneData }];
  return Object.values(ctx.project.nodes).filter((n) => n.type === 'core.scene').map((n) => ({ node: n, scene: n.data as SceneData }));
}

function ArgEditor({ arg, value, onChange, ctx, block }: { arg: BlockDef['args'][number]; value: any; onChange: (v: any) => void; ctx: BlockCtx; block: Block }) {
  const t = ctx.t;
  // Optional slots can be left empty ("this script", "any item"…).
  const emptyKey = `block.empty.${block.type}.${arg.id}`;
  const emptyFallback = arg.type === 'item' ? 'items.any' : arg.type === 'layer' ? 'script.thisScript' : 'script.emptyArg';
  const emptyLabel = !arg.optional ? null : t(emptyKey) !== emptyKey ? t(emptyKey) : t(emptyFallback);
  const sel = (options: { value: string; label: string; group?: string }[], placeholder = emptyLabel ?? t('common.choose')) => {
    const groups = [...new Set(options.map((o) => o.group || ''))];
    const known = options.some((o) => o.value === value);
    return (
      <select className={cx('blk-select', value && !known && 'missing', !value && emptyLabel && 'empty-ok')} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} onKeyDown={(e) => e.stopPropagation()} aria-label={arg.id}>
        {(!value || !known) && <option value={value ?? ''}>{value && !known ? t('script.missingRef') : placeholder}</option>}
        {value && known && emptyLabel && <option value="">{emptyLabel}</option>}
        {groups.length > 1
          ? groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => (o.group || '') === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)
          : options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  };
  const scenes = scenesForCtx(ctx);
  const multi = scenes.length > 1;
  switch (arg.type) {
    case 'number': return <ValueInput value={value} onChange={onChange} ctx={ctx} numeric />;
    case 'string': return <ValueInput value={value} onChange={onChange} ctx={ctx} />;
    case 'expr': return <ExprInput value={value} onChange={(e) => onChange(e)} ctx={ctx} allowClear={!!arg.optional} />;
    case 'boolean': return <label className="blk-check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span>{t(`block.arg.${block.type}.${arg.id}`) !== `block.arg.${block.type}.${arg.id}` ? t(`block.arg.${block.type}.${arg.id}`) : ''}</span></label>;
    case 'layer': {
      const fits = (type: string) => !arg.layerTypes || arg.layerTypes.includes('*') || arg.layerTypes.includes(type);
      if (!multi && hasSceneData(ctx.project.nodes[ctx.nodeId])) {
        // A page: its own elements, then inherited and global ones.
        const groupOf = { own: '', inherited: t('inherit.section'), global: t('global.section') };
        const list = pageElementsOf(ctx.engine, ctx.project, ctx.nodeId).filter((e) => fits(e.layer.type) && e.layer.type !== 'core.dialogue');
        const grouped = list.some((e) => e.origin !== 'own');
        return sel(list.map((e) => ({ value: e.layer.id, label: e.layer.name, group: grouped ? groupOf[e.origin] || t('inherit.thisPage') : undefined })));
      }
      const g = pageCtxOf(ctx.engine, ctx.project, ctx.nodeId);
      return sel([...scenes.flatMap(({ node, scene }) => scene.layers.filter((l) => fits(l.type)).map((l) => ({ value: l.id, label: l.name, group: multi ? node.name : undefined }))),
        ...[...g.globalBack, ...g.globalFront].filter((l) => fits(l.type)).map((l) => ({ value: l.id, label: l.name, group: t('global.section') }))]);
    }
    case 'item': return sel(ctx.project.items.map((i) => ({ value: i.id, label: i.name })), emptyLabel ?? t('items.choose'));
    case 'param': {
      const layerId = block.args[arg.paramOf || 'layer'];
      const l = pageElementsOf(ctx.engine, ctx.project, ctx.nodeId).find((e) => e.layer.id === layerId)?.layer
        || Object.values(ctx.project.nodes).flatMap((n) => (n.data as any)?.layers || []).find((x: any) => x.id === layerId);
      return sel((l?.params || []).map((p: any) => ({ value: p.id, label: p.name })), l ? (l.params?.length ? t('params.choose') : t('params.none')) : t('params.pickElement'));
    }
    case 'animation': return sel(scenes.flatMap(({ node, scene }) => scene.animations.map((a) => ({ value: a.id, label: a.name, group: multi ? node.name : undefined }))));
    case 'choice': return sel(scenes.flatMap(({ node, scene }) => sceneChoices(scene).map((c) => ({ value: c.id, label: c.text || '—', group: multi ? node.name : undefined }))));
    case 'line': return sel(scenes.flatMap(({ node, scene }) => sceneLines(scene).map((l, i) => ({ value: l.id, label: `${i + 1}. ${l.text.slice(0, 28)}`, group: multi ? node.name : undefined }))));
    case 'port': {
      const node = ctx.project.nodes[ctx.nodeId];
      const sc = node?.type === 'core.scene' ? (node.data as SceneData) : null;
      const opts = sc && sceneChoices(sc).length ? sceneChoices(sc).map((c) => ({ value: `c:${c.id}`, label: `${t('port.choice')}: ${c.text}` })) : [{ value: 'next', label: t('port.next') }];
      return sel(opts);
    }
    case 'node': return sel(Object.values(ctx.project.nodes).filter((n) => n.type !== 'core.comment').map((n) => ({ value: n.id, label: n.name, group: ctx.project.chapters.find((c) => c.id === n.chapterId)?.name })));
    case 'variable': {
      const ok = (v: { type: string }) => !arg.varType || v.type === arg.varType;
      return sel([...ctx.project.variables.filter(ok).map((v) => ({ value: v.id, label: v.name })), ...scenes.flatMap(({ scene }) => scene.localVariables.filter(ok).map((v) => ({ value: v.id, label: `${v.name} (${t('vars.scene')})` })))], arg.varType === 'list' ? t('vars.chooseList') : undefined);
    }
    case 'asset': return sel(ctx.project.assets.filter((a) => !arg.assetKind || a.kind === arg.assetKind).map((a) => ({ value: a.id, label: a.name })));
    case 'character': return sel(ctx.project.characters.map((c) => ({ value: c.id, label: c.name })));
    case 'portrait': {
      // Portraits of the character shown by the chosen layer, or of every character.
      const layerId = block.args.layer;
      let charId: string | null = null;
      for (const { scene } of scenes) { const l = scene.layers.find((x) => x.id === layerId); if (l?.type === 'core.character') { charId = l.props.characterId; break; } }
      const chars = ctx.project.characters.filter((c) => !charId || c.id === charId);
      return sel(chars.flatMap((c) => c.portraits.map((pt) => ({ value: pt.id, label: pt.name, group: chars.length > 1 ? c.name : undefined }))));
    }
    case 'motion':
    case 'expression': {
      // Motions / expressions of the character shown by the chosen layer, or of every character.
      const layerId = block.args.layer;
      let charId: string | null = null;
      for (const { scene } of scenes) { const l = scene.layers.find((x) => x.id === layerId); if (l?.type === 'core.character') { charId = l.props.characterId; break; } }
      const chars = ctx.project.characters.filter((c) => !charId || c.id === charId);
      return sel(chars.flatMap((c) => ((arg.type === 'motion' ? c.motions : c.expressions) || []).map((m: { id: string; name: string }) => ({ value: m.id, label: m.name, group: chars.length > 1 ? c.name : undefined }))));
    }
    case 'behavior': return sel(ctx.project.behaviors.map((b: Behavior) => ({ value: b.id, label: b.name })));
    case 'key': case 'select': case 'ease': return sel((arg.options || []).map((o) => ({ value: String(o.value), label: t(o.label) })), '—');
    case 'message': return <MessageInput value={String(value ?? '')} onChange={onChange} project={ctx.project} />;
    case 'prop': {
      const layerId = block.args.layer;
      let type: string | null = null;
      for (const { scene } of scenes) { const l = scene.layers.find((x) => x.id === layerId); if (l) { type = l.type; break; } }
      const props = type ? ctx.engine.layerProps(type) : ctx.engine.layerProps('core.image');
      return sel([...props.filter((p) => !p.hidden && p.type !== 'json').map((p) => ({ value: p.key, label: t(p.label) })), { value: 'visible', label: t('prop.visible') }], '—');
    }
  }
  return <ValueInput value={value} onChange={onChange} ctx={ctx} />;
}

function MessageInput({ value, onChange, project }: { value: string; onChange: (v: string) => void; project: Project }) {
  const listId = useRef(`msgs-${Math.random().toString(36).slice(2)}`).current;
  const known = useMemo(() => {
    const out = new Set<string>();
    const walk = (bs: Block[] | undefined) => { for (const b of bs || []) { if (typeof b.args?.message === 'string' && b.args.message) out.add(b.args.message); walk(b.body); walk(b.else); } };
    for (const n of Object.values(project.nodes)) if (hasSceneData(n)) for (const s of (n.data as SceneData).scripts) { walk([s.hat]); walk(s.body); }
    return [...out];
  }, [project]);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <>
      <input className="expr-lit msg" list={listId} value={draft} style={{ width: `${Math.max(4, draft.length + 1)}ch` }} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onChange(draft)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="message" />
      <datalist id={listId}>{known.map((k) => <option key={k} value={k} />)}</datalist>
    </>
  );
}

export function blockPaletteItems(engine: Engine, t: (k: string) => string, mode: 'scene' | 'story', onPick: (def: BlockDef) => void): MenuItem[] {
  const cats = new Map<string, BlockDef[]>();
  for (const d of engine.blocks.list()) {
    if (mode === 'story' && (d.shape === 'hat' || d.context === 'scene')) continue;
    if (!cats.has(d.category)) cats.set(d.category, []);
    cats.get(d.category)!.push(d);
  }
  return [...cats].map(([c, list]) => ({ label: t(`block.cat.${c}`), submenu: list.map((d) => ({ label: t(d.label).replace(/\{\w+\}/g, '…'), onClick: () => onPick(d) })) }));
}
