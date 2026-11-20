import { useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import type { Block, BlockDef, Engine, Project, SceneData, StoryNode, Behavior } from '@vne/core';
import { newId, remapIds } from '@vne/core';
import { Icon } from '../ui/Icon';
import { cx, IconButton, Toggle } from '../ui/controls';
import { openMenu, MenuItem } from '../ui/Menu';
import { ExprInput, ValueInput, ExprCtx } from './ExprInput';

export interface WStack { id: string; hat: Block | null; body: Block[]; enabled: boolean; x?: number; y?: number }

export const CATEGORY_COLORS: Record<string, string> = {
  events: '#d9a520', control: '#e8873a', looks: '#8b6cf0', sound: '#c75ec7', variables: '#e0566b', story: '#4c8dff', operators: '#4fb35a', module: '#25a89c',
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

function findBlock(stacks: WStack[], blockId: string): Block | null {
  const f = (list: Block[]): Block | null => {
    for (const b of list) {
      if (b.id === blockId) return b;
      const r = (b.body && f(b.body)) || (b.else && f(b.else));
      if (r) return r;
    }
    return null;
  };
  for (const s of stacks) {
    if (s.hat?.id === blockId) return s.hat;
    const r = f(s.body);
    if (r) return r;
  }
  return null;
}

function contains(b: Block, key: ListKey): boolean {
  if (`${b.id}.body` === key || `${b.id}.else` === key) return true;
  return [...(b.body || []), ...(b.else || [])].some((c) => contains(c, key));
}

/* ------------------------------------------------------------------ */
/* Drag & drop                                                          */
/* ------------------------------------------------------------------ */

type DragState = { kind: 'new'; def: BlockDef } | { kind: 'move'; blockId: string; label: string; color: string };

function useBlockDrag(onDrop: (d: DragState, target: { list: ListKey; index: number } | { newStack: true } | null) => void) {
  const [drag, setDrag] = useState<(DragState & { x: number; y: number; target: string | null }) | null>(null);
  const start = (e: React.PointerEvent, d: DragState) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, button:not(.blk-grab), .expr')) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    let target: { list: ListKey; index: number } | { newStack: true } | null = null;
    const locate = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const gap = el?.closest('.blk-gap') as HTMLElement | null;
      if (gap) return { list: gap.dataset.list!, index: Number(gap.dataset.index) };
      // nearest gap within the hovered list
      const list = el?.closest('.blk-list') as HTMLElement | null;
      if (list) {
        const gaps = [...list.querySelectorAll<HTMLElement>(':scope > .blk-gap')];
        let best: HTMLElement | null = null, bd = Infinity;
        for (const g of gaps) { const r = g.getBoundingClientRect(); const dd = Math.abs(r.top + r.height / 2 - y); if (dd < bd) { bd = dd; best = g; } }
        if (best) return { list: best.dataset.list!, index: Number(best.dataset.index) };
      }
      if (el?.closest('.blk-workspace-drop')) return { newStack: true as const };
      return null;
    };
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      active = true;
      target = locate(ev.clientX, ev.clientY);
      setDrag({ ...d, x: ev.clientX, y: ev.clientY, target: target ? ('list' in target ? `${target.list}:${target.index}` : 'new') : null } as any);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-block');
      setDrag(null);
      if (active) onDrop(d, target);
      else if (d.kind === 'new') onDrop(d, null); // click on palette = append
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

export function BlockWorkspace({ stacks, onChange, ctx, mode, selectedStack, onSelectStack, header }: {
  stacks: WStack[];
  onChange: (recipe: (draft: WStack[]) => void, label: string) => void;
  ctx: BlockCtx;
  mode: 'scene' | 'story';
  selectedStack?: string | null;
  onSelectStack?: (id: string | null) => void;
  header?: ReactNode;
}) {
  const t = ctx.t;
  const engine = ctx.engine;
  const [category, setCategory] = useState<string>(mode === 'scene' ? 'events' : 'looks');
  const [query, setQuery] = useState('');
  const defs = useMemo(() => engine.blocks.list().filter((d) => (mode === 'scene' ? d.context !== 'story' : d.shape !== 'hat' && d.context !== 'scene' ? true : d.shape !== 'hat' && mode === 'story' && d.context === 'scene' ? false : d.shape !== 'hat')), [engine, mode, engine.blocks.list().length]);
  const usable = defs.filter((d) => (mode === 'story' ? d.shape !== 'hat' && d.context !== 'scene' : true));
  const categories = [...new Set(usable.map((d) => d.category))];
  const order = ['events', 'control', 'looks', 'sound', 'variables', 'story', 'operators'];
  categories.sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  const shown = usable.filter((d) => (query ? t(d.label).toLowerCase().includes(query.toLowerCase()) || d.id.toLowerCase().includes(query.toLowerCase()) : d.category === category));

  const targetStack = selectedStack && stacks.some((s) => s.id === selectedStack) ? selectedStack : stacks[stacks.length - 1]?.id;

  const { drag, start } = useBlockDrag((d, target) => {
    if (d.kind === 'new') {
      const def = d.def;
      if (def.shape === 'hat') {
        if (mode !== 'scene') return;
        const id = newId('scr');
        onChange((draft) => { draft.push({ id, hat: newBlock(def), body: [], enabled: true, x: 0, y: 0 }); }, t('script.addScript'));
        onSelectStack?.(id);
        return;
      }
      const block = newBlock(def);
      if (target && 'list' in target) onChange((draft) => { findList(draft, target.list)?.splice(target.index, 0, block); }, t('script.addBlock'));
      else if (target && 'newStack' in target && mode === 'scene') {
        // statements need a trigger: start a new script that runs when the scene starts
        const hat = engine.blocks.get('core.whenSceneStarts');
        if (hat) onChange((draft) => { draft.push({ id: newId('scr'), hat: newBlock(hat), body: [block], enabled: true }); }, t('script.addScript'));
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
    drag,
    startMove: (e, b) => { const def = engine.blocks.get(b.type); start(e, { kind: 'move', blockId: b.id, label: t(def?.label || b.type), color: blockColor(def) }); },
    setArg: (blockId, arg, value) => onChange((draft) => { const b = findBlock(draft, blockId); if (b) b.args[arg] = value; }, t('script.editBlock')),
    remove: (blockId) => onChange((draft) => { removeBlock(draft, blockId); }, t('script.deleteBlock')),
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
          {shown.map((d) => (
            <div key={d.id} className={cx('blk', `shape-${d.shape}`, 'palette')} style={{ ['--blk' as any]: blockColor(d) }} onPointerDown={(e) => start(e, { kind: 'new', def: d })} title={t('script.dragOrClick')}>
              <BlockLabel def={d} block={null} ops={null} />
            </div>
          ))}
          {!shown.length && <div className="muted small pad">{t('common.noResults')}</div>}
        </div>
      </aside>
      <div className="blk-main">
        {header}
        <div className="blk-workspace blk-workspace-drop">
          {stacks.map((s) => (
            <div key={s.id} className={cx('blk-stack', s.id === targetStack && 'targeted', !s.enabled && 'disabled')} onPointerDown={() => onSelectStack?.(s.id)}>
              {s.hat && (
                <div className="blk shape-hat" style={{ ['--blk' as any]: blockColor(engine.blocks.get(s.hat.type)) }}>
                  <BlockLabel def={engine.blocks.get(s.hat.type)} block={s.hat} ops={ops} />
                  <div className="blk-tools">
                    <Toggle value={s.enabled} onChange={(v) => onChange((draft) => { const x = draft.find((y) => y.id === s.id); if (x) x.enabled = v; }, t('script.toggleScript'))} title={t('script.enabled')} />
                    <IconButton icon="more" size={14} title={t('common.more')} onClick={(e) => openMenu(e, [
                      { label: t('script.duplicateScript'), icon: 'duplicate', onClick: () => onChange((draft) => { const x = draft.find((y) => y.id === s.id); if (x) draft.push(remapIds(JSON.parse(JSON.stringify(x))).value); }, t('script.duplicateScript')) },
                      { label: t('script.changeTrigger'), icon: 'bolt', submenu: engine.blocks.list().filter((d) => d.shape === 'hat').map((d) => ({ label: t(d.label).replace(/\{\w+\}/g, '…'), onClick: () => onChange((draft) => { const x = draft.find((y) => y.id === s.id); if (x) x.hat = newBlock(d); }, t('script.changeTrigger')) })) },
                      { separator: true },
                      { label: t('script.deleteScript'), icon: 'trash', danger: true, onClick: () => onChange((draft) => { const i = draft.findIndex((y) => y.id === s.id); if (i >= 0) draft.splice(i, 1); }, t('script.deleteScript')) },
                    ])} />
                  </div>
                </div>
              )}
              <BlockList list={s.body} listKey={s.id} ops={ops} />
            </div>
          ))}
          {!stacks.length && (
            <div className="blk-empty">
              <Icon name="script" size={26} />
              <div>{mode === 'scene' ? t('script.emptyScene') : t('script.emptyActions')}</div>
            </div>
          )}
        </div>
      </div>
      {drag && (
        <div className="blk-ghost" style={{ left: drag.x + 10, top: drag.y + 6, ['--blk' as any]: drag.kind === 'new' ? blockColor(drag.def) : drag.color }}>
          {drag.kind === 'new' ? t(drag.def.label).replace(/\{\w+\}/g, '…') : drag.label.replace(/\{\w+\}/g, '…')}
        </div>
      )}
    </div>
  );
}

interface BlockOps {
  ctx: BlockCtx;
  drag: { target: string | null } | null;
  startMove(e: React.PointerEvent, b: Block): void;
  setArg(blockId: string, arg: string, value: any): void;
  remove(blockId: string): void;
  duplicate(blockId: string): void;
}

function BlockList({ list, listKey, ops }: { list: Block[]; listKey: string; ops: BlockOps }) {
  const gap = (i: number) => <div key={`g${i}`} className={cx('blk-gap', ops.drag?.target === `${listKey}:${i}` && 'hot')} data-list={listKey} data-index={i} />;
  const items: ReactNode[] = [gap(0)];
  list.forEach((b, i) => {
    items.push(<BlockView key={b.id} block={b} ops={ops} />);
    items.push(gap(i + 1));
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
    <div className={cx('blk-wrap', `shape-${def.shape}`)}>
      <div className={cx('blk', `shape-${def.shape}`)} style={{ ['--blk' as any]: color }} onPointerDown={(e) => ops.startMove(e, block)} onContextMenu={ctxMenu}
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
        if (!block || !ops) return <span key={i} className="blk-slot">{arg.type === 'boolean' ? '☐' : '…'}</span>;
        return <ArgEditor key={i} arg={arg} value={block.args[arg.id]} onChange={(v) => ops.setArg(block.id, arg.id, v)} ctx={ops.ctx} block={block} />;
      })}
    </span>
  );
}

function scenesForCtx(ctx: BlockCtx): { node: StoryNode; scene: SceneData }[] {
  const node = ctx.project.nodes[ctx.nodeId];
  if (node?.type === 'core.scene' && !ctx.storyLevel) return [{ node, scene: node.data as SceneData }];
  return Object.values(ctx.project.nodes).filter((n) => n.type === 'core.scene').map((n) => ({ node: n, scene: n.data as SceneData }));
}

function ArgEditor({ arg, value, onChange, ctx, block }: { arg: BlockDef['args'][number]; value: any; onChange: (v: any) => void; ctx: BlockCtx; block: Block }) {
  const t = ctx.t;
  const sel = (options: { value: string; label: string; group?: string }[], placeholder = t('common.choose')) => {
    const groups = [...new Set(options.map((o) => o.group || ''))];
    const known = options.some((o) => o.value === value);
    return (
      <select className={cx('blk-select', value && !known && 'missing')} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} onKeyDown={(e) => e.stopPropagation()} aria-label={arg.id}>
        {(!value || !known) && <option value={value ?? ''}>{value && !known ? t('script.missingRef') : placeholder}</option>}
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
    case 'expr': return <ExprInput value={value} onChange={(e) => onChange(e)} ctx={ctx} allowClear={false} />;
    case 'boolean': return <label className="blk-check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span>{t(`block.arg.${block.type}.${arg.id}`) !== `block.arg.${block.type}.${arg.id}` ? t(`block.arg.${block.type}.${arg.id}`) : ''}</span></label>;
    case 'layer': return sel(scenes.flatMap(({ node, scene }) => scene.layers.map((l) => ({ value: l.id, label: l.name, group: multi ? node.name : undefined }))));
    case 'animation': return sel(scenes.flatMap(({ node, scene }) => scene.animations.map((a) => ({ value: a.id, label: a.name, group: multi ? node.name : undefined }))));
    case 'choice': return sel(scenes.flatMap(({ node, scene }) => scene.choices.map((c) => ({ value: c.id, label: c.text || '—', group: multi ? node.name : undefined }))));
    case 'line': return sel(scenes.flatMap(({ node, scene }) => scene.dialogue.map((l, i) => ({ value: l.id, label: `${i + 1}. ${l.text.slice(0, 28)}`, group: multi ? node.name : undefined }))));
    case 'port': {
      const node = ctx.project.nodes[ctx.nodeId];
      const sc = node?.type === 'core.scene' ? (node.data as SceneData) : null;
      const opts = sc && sc.choices.length ? sc.choices.map((c) => ({ value: `c:${c.id}`, label: `${t('port.choice')}: ${c.text}` })) : [{ value: 'next', label: t('port.next') }];
      return sel(opts);
    }
    case 'node': return sel(Object.values(ctx.project.nodes).filter((n) => n.type !== 'core.comment').map((n) => ({ value: n.id, label: n.name, group: ctx.project.chapters.find((c) => c.id === n.chapterId)?.name })));
    case 'variable': return sel([...ctx.project.variables.map((v) => ({ value: v.id, label: v.name })), ...scenes.flatMap(({ scene }) => scene.localVariables.map((v) => ({ value: v.id, label: `${v.name} (${t('vars.scene')})` })))]);
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
    for (const n of Object.values(project.nodes)) if (n.type === 'core.scene') for (const s of (n.data as SceneData).scripts) { walk([s.hat]); walk(s.body); }
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
