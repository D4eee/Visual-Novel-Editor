import { ReactNode, useEffect, useMemo, useRef, useState, KeyboardEvent as RKeyboardEvent, memo } from 'react';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/controls';

export interface GPort { id: string; label?: string; type: string; color: string; multiple?: boolean }
export interface GNode {
  id: string; x: number; y: number; width: number; title: string; subtitle?: string; color: string; icon?: string;
  inputs: GPort[]; outputs: GPort[]; body?: ReactNode; className?: string; badge?: ReactNode; status?: 'error' | 'warning' | null;
  headerExtra?: ReactNode; minHeight?: number; tooltip?: string;
}
export interface GEdge { id: string; from: { node: string; port: string }; to: { node: string; port: string }; color: string; dashed?: boolean }
export interface View { x: number; y: number; zoom: number }
type End = { node: string; port: string };

export const HEADER = 34;
export const ROW = 24;

export function portPos(n: GNode, side: 'in' | 'out', portId: string): { x: number; y: number } | null {
  const list = side === 'in' ? n.inputs : n.outputs;
  const i = list.findIndex((p) => p.id === portId);
  if (i < 0) return null;
  return { x: side === 'in' ? n.x : n.x + n.width, y: n.y + HEADER + i * ROW + ROW / 2 };
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export interface GraphCanvasProps {
  nodes: GNode[];
  edges: GEdge[];
  view: View;
  onView: (v: View) => void;
  selectedNodes: Set<string>;
  selectedEdges: Set<string>;
  onSelect: (nodes: string[], edges: string[]) => void;
  onMove: (positions: { id: string; x: number; y: number }[], phase: 'move' | 'end') => void;
  onConnect: (from: End, to: End) => void;
  /** Return true or a reason string (shown as a tooltip) when the connection is not allowed. */
  canConnect: (from: End, to: End) => true | string;
  onDropConnection?: (from: End & { side: 'out' | 'in'; type: string }, world: { x: number; y: number }, screen: { x: number; y: number }) => void;
  onDetachEdge?: (edgeId: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onCanvasDoubleClick?: (world: { x: number; y: number }, screen: { x: number; y: number }) => void;
  onContextMenu?: (target: { kind: 'node' | 'edge' | 'canvas' | 'port'; id?: string; port?: string; side?: 'in' | 'out' }, e: React.MouseEvent | PointerEvent, world: { x: number; y: number }) => void;
  onKeyDown?: (e: RKeyboardEvent) => void;
  portsCompatible?: (from: GPort, to: GPort) => boolean;
  grid?: number;
  emptyHint?: ReactNode;
  focusKey?: string | number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Infinite node canvas with pan/zoom, selection, node dragging and typed port
 * connections. Dragging a port only ever draws a connection; dragging a node
 * only moves nodes; dragging empty space pans (Shift/Ctrl+drag box-selects).
 */
export function GraphCanvas(p: GraphCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<{ from: End; side: 'out' | 'in'; type: string; color: string; x: number; y: number; hover: End | null; reason?: string } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [drag, setDrag] = useState<Map<string, { x: number; y: number }> | null>(null);
  const viewRef = useRef(p.view);
  viewRef.current = p.view;
  const byId = useMemo(() => new Map(p.nodes.map((n) => [n.id, n])), [p.nodes]);
  const grid = p.grid ?? 16;

  const toWorld = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  };

  // Wheel zoom around the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const r = el.getBoundingClientRect();
      if (e.shiftKey) { p.onView({ ...v, x: v.x - e.deltaY, y: v.y }); return; }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const zoom = Math.max(0.15, Math.min(2.5, v.zoom * factor));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      p.onView({ zoom, x: mx - ((mx - v.x) / v.zoom) * zoom, y: my - ((my - v.y) / v.zoom) * zoom });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [p.onView]);

  /* Background: pan / box select / clear selection / context menu ------- */
  const onBackgroundDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.gnode, .gport, .gedge-hit')) return;
    ref.current?.focus();
    const startX = e.clientX, startY = e.clientY;
    const v0 = viewRef.current;
    const boxMode = e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      if (boxMode) setBox({ x0: startX, y0: startY, x1: ev.clientX, y1: ev.clientY });
      else p.onView({ ...v0, x: v0.x + ev.clientX - startX, y: v0.y + ev.clientY - startY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('panning');
      if (boxMode && moved) {
        const a = toWorld(Math.min(startX, ev.clientX), Math.min(startY, ev.clientY));
        const b = toWorld(Math.max(startX, ev.clientX), Math.max(startY, ev.clientY));
        const hits = p.nodes.filter((n) => n.x < b.x && n.x + n.width > a.x && n.y < b.y && n.y + HEADER + 40 > a.y).map((n) => n.id);
        const keep = e.shiftKey || e.ctrlKey || e.metaKey ? [...p.selectedNodes] : [];
        p.onSelect([...new Set([...keep, ...hits])], []);
        setBox(null);
      } else if (!moved) {
        if (e.button === 2) p.onContextMenu?.({ kind: 'canvas' }, ev, toWorld(ev.clientX, ev.clientY));
        else if (e.button === 0) p.onSelect([], []);
      }
    };
    if (!boxMode) document.body.classList.add('panning');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* Nodes: select and drag ------------------------------------------------ */
  const onNodeDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.gport, [data-nodrag], input, textarea, select, button')) return;
    e.stopPropagation();
    ref.current?.focus();
    let sel = new Set(p.selectedNodes);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) { if (sel.has(id)) sel.delete(id); else sel.add(id); }
    else if (!sel.has(id)) sel = new Set([id]);
    p.onSelect([...sel], []);
    if (additive && !sel.has(id)) return;
    const starts = new Map<string, { x: number; y: number }>();
    for (const sid of sel) { const n = byId.get(sid); if (n) starts.set(sid, { x: n.x, y: n.y }); }
    const w0 = toWorld(e.clientX, e.clientY);
    let moved = false;
    let last: { id: string; x: number; y: number }[] = [];
    const move = (ev: PointerEvent) => {
      const w = toWorld(ev.clientX, ev.clientY);
      const dx = w.x - w0.x, dy = w.y - w0.y;
      if (!moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return;
      moved = true;
      const snap = !ev.altKey;
      last = [...starts].map(([sid, s]) => ({ id: sid, x: snap ? Math.round((s.x + dx) / grid) * grid : s.x + dx, y: snap ? Math.round((s.y + dy) / grid) * grid : s.y + dy }));
      setDrag(new Map(last.map((q) => [q.id, { x: q.x, y: q.y }])));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved && last.length) p.onMove(last, 'end');
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* Ports: draw a connection --------------------------------------------- */
  const findPortAt = (x: number, y: number): (End & { side: 'in' | 'out' }) | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const portEl = el?.closest('.gport') as HTMLElement | null;
    if (portEl) return { node: portEl.dataset.node!, port: portEl.dataset.port!, side: portEl.dataset.side as 'in' | 'out' };
    return null;
  };

  const onPortDown = (e: React.PointerEvent, node: GNode, port: GPort, side: 'in' | 'out') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current?.focus();
    let from: End = { node: node.id, port: port.id };
    let fromSide = side;
    let type = port.type;
    let color = port.color;
    // Dragging from a connected single input picks the connection up (Blender-style re-route).
    if (side === 'in') {
      const conns = p.edges.filter((ed) => ed.to.node === node.id && ed.to.port === port.id);
      if (conns.length === 1 && (!port.multiple || e.altKey)) {
        const ed = conns[0];
        const src = byId.get(ed.from.node);
        const sp = src?.outputs.find((o) => o.id === ed.from.port);
        if (src && sp) {
          p.onDetachEdge?.(ed.id);
          from = { node: src.id, port: sp.id };
          fromSide = 'out';
          type = sp.type;
          color = sp.color;
        }
      }
    }
    const w = toWorld(e.clientX, e.clientY);
    setLink({ from, side: fromSide, type, color, x: w.x, y: w.y, hover: null });
    const resolveTarget = (ev: PointerEvent): End | null => {
      const hit = findPortAt(ev.clientX, ev.clientY);
      if (hit && hit.side !== fromSide) return { node: hit.node, port: hit.port };
      // Released over a node body: use its first compatible port on the opposite side.
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.gnode') as HTMLElement | null;
      if (el && el.dataset.id && el.dataset.id !== from.node) {
        const n = byId.get(el.dataset.id);
        const list = fromSide === 'out' ? n?.inputs : n?.outputs;
        const fromPort: GPort = { id: from.port, type, color };
        const cand = list?.find((q) => (p.portsCompatible ? (fromSide === 'out' ? p.portsCompatible(fromPort, q) : p.portsCompatible(q, fromPort)) : true));
        if (n && cand) return { node: n.id, port: cand.id };
      }
      return null;
    };
    const move = (ev: PointerEvent) => {
      const ww = toWorld(ev.clientX, ev.clientY);
      const target = resolveTarget(ev);
      let reason: string | undefined;
      if (target) {
        const r = fromSide === 'out' ? p.canConnect(from, target) : p.canConnect(target, from);
        if (r !== true) reason = r;
      }
      setLink((l) => (l ? { ...l, x: ww.x, y: ww.y, hover: target, reason } : l));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const target = resolveTarget(ev);
      setLink(null);
      if (target) {
        const [a, b] = fromSide === 'out' ? [from, target] : [target, from];
        if (p.canConnect(a, b) === true) p.onConnect(a, b);
      } else if (!findPortAt(ev.clientX, ev.clientY) && !(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.gnode')) {
        p.onDropConnection?.({ ...from, side: fromSide, type }, toWorld(ev.clientX, ev.clientY), { x: ev.clientX, y: ev.clientY });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Nodes as rendered (with in-progress drag positions applied)
  const shown = useMemo(() => (drag ? p.nodes.map((n) => (drag.has(n.id) ? { ...n, ...drag.get(n.id)! } : n)) : p.nodes), [p.nodes, drag]);
  const shownById = useMemo(() => new Map(shown.map((n) => [n.id, n])), [shown]);

  const v = p.view;
  const connectedIn = useMemo(() => new Set(p.edges.map((e) => `${e.to.node}:${e.to.port}`)), [p.edges]);
  const connectedOut = useMemo(() => new Set(p.edges.map((e) => `${e.from.node}:${e.from.port}`)), [p.edges]);

  return (
    <div
      ref={ref}
      className={cx('graph', link && 'linking', p.className)}
      tabIndex={0}
      aria-label={p.ariaLabel}
      onPointerDown={onBackgroundDown}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.gnode, .gport')) return;
        p.onCanvasDoubleClick?.(toWorld(e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
      }}
      onKeyDown={p.onKeyDown}
      style={{ backgroundPosition: `${v.x}px ${v.y}px`, backgroundSize: `${grid * 2 * v.zoom}px ${grid * 2 * v.zoom}px` }}
    >
      <div className="graph-world" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` }}>
        <svg className="graph-edges" width="1" height="1">
          {p.edges.map((e) => {
            const a = shownById.get(e.from.node), b = shownById.get(e.to.node);
            if (!a || !b) return null;
            const pa = portPos(a, 'out', e.from.port), pb = portPos(b, 'in', e.to.port);
            if (!pa || !pb) return null;
            const d = edgePath(pa, pb);
            const sel = p.selectedEdges.has(e.id) || (p.selectedNodes.has(a.id) || p.selectedNodes.has(b.id));
            return (
              <g key={e.id} className={cx('gedge', sel && 'selected')}>
                <path d={d} className="gedge-hit" onPointerDown={(ev) => {
                  if (ev.button === 2) return;
                  ev.stopPropagation();
                  ref.current?.focus();
                  p.onSelect([], [e.id]);
                }} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); p.onSelect([], [e.id]); p.onContextMenu?.({ kind: 'edge', id: e.id }, ev, toWorld(ev.clientX, ev.clientY)); }} />
                <path d={d} className="gedge-line" stroke={e.color} strokeDasharray={e.dashed ? '6 5' : undefined} />
              </g>
            );
          })}
          {link && (() => {
            const n = shownById.get(link.from.node);
            const pp = n && portPos(n, link.side, link.from.port);
            if (!pp) return null;
            const end = { x: link.x, y: link.y };
            const d = link.side === 'out' ? edgePath(pp, end) : edgePath(end, pp);
            return <path d={d} className={cx('gedge-line', 'pending', link.reason && 'invalid')} stroke={link.reason ? '#ef5f6b' : link.color} />;
          })()}
        </svg>
        {shown.map((n) => (
          <NodeView key={n.id} n={n} selected={p.selectedNodes.has(n.id)} onDown={onNodeDown} onPortDown={onPortDown}
            onDouble={p.onNodeDoubleClick} onContext={(e) => { e.preventDefault(); e.stopPropagation(); if (!p.selectedNodes.has(n.id)) p.onSelect([n.id], []); p.onContextMenu?.({ kind: 'node', id: n.id }, e, toWorld(e.clientX, e.clientY)); }}
            onPortContext={(e, port, side) => { e.preventDefault(); e.stopPropagation(); p.onContextMenu?.({ kind: 'port', id: n.id, port, side }, e, toWorld(e.clientX, e.clientY)); }}
            connectedIn={connectedIn} connectedOut={connectedOut}
            linkType={link ? { type: link.type, side: link.side, color: link.color, from: link.from } : null}
            hover={link?.hover || null} compat={p.portsCompatible} />
        ))}
      </div>
      {box && <div className="graph-box" style={{ left: Math.min(box.x0, box.x1) - (ref.current?.getBoundingClientRect().left || 0), top: Math.min(box.y0, box.y1) - (ref.current?.getBoundingClientRect().top || 0), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
      {link?.reason && link.hover && <div className="graph-tip" style={{ left: link.x * v.zoom + v.x + 14, top: link.y * v.zoom + v.y + 14 }}>{link.reason}</div>}
      {!p.nodes.length && p.emptyHint && <div className="graph-empty">{p.emptyHint}</div>}
    </div>
  );
}

const NodeView = memo(function NodeView({ n, selected, onDown, onPortDown, onDouble, onContext, onPortContext, connectedIn, connectedOut, linkType, hover, compat }: {
  n: GNode; selected: boolean; onDown: (e: React.PointerEvent, id: string) => void;
  onPortDown: (e: React.PointerEvent, n: GNode, p: GPort, side: 'in' | 'out') => void;
  onDouble?: (id: string) => void; onContext: (e: React.MouseEvent) => void; onPortContext: (e: React.MouseEvent, port: string, side: 'in' | 'out') => void;
  connectedIn: Set<string>; connectedOut: Set<string>;
  linkType: { type: string; side: 'in' | 'out'; color: string; from: End } | null; hover: End | null; compat?: (a: GPort, b: GPort) => boolean;
}) {
  const rows = Math.max(n.inputs.length, n.outputs.length);
  const portClass = (port: GPort, side: 'in' | 'out') => {
    if (!linkType) return '';
    if (linkType.side === side) return 'dim';
    if (linkType.from.node === n.id) return 'dim';
    const fromPort: GPort = { id: '', type: linkType.type, color: linkType.color };
    const ok = compat ? (side === 'in' ? compat(fromPort, port) : compat(port, fromPort)) : true;
    return ok ? 'target' : 'dim';
  };
  return (
    <div
      className={cx('gnode', selected && 'selected', n.status && `status-${n.status}`, n.className)}
      data-id={n.id}
      style={{ left: n.x, top: n.y, width: n.width, minHeight: n.minHeight, ['--node-color' as any]: n.color }}
      onPointerDown={(e) => onDown(e, n.id)}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('input, textarea, select, button')) { e.stopPropagation(); onDouble?.(n.id); } }}
      onContextMenu={onContext}
      title={n.tooltip}
    >
      <div className="gnode-head">
        {n.icon && <Icon name={n.icon} size={15} className="gnode-icon" />}
        <div className="gnode-titles">
          <div className="gnode-title">{n.title}</div>
          {n.subtitle && <div className="gnode-sub">{n.subtitle}</div>}
        </div>
        {n.badge}
        {n.headerExtra}
      </div>
      {rows > 0 && (
        <div className="gnode-ports">
          {Array.from({ length: rows }).map((_, i) => {
            const ip = n.inputs[i], op = n.outputs[i];
            return (
              <div className="gport-row" key={i}>
                <div className="gport-cell in">
                  {ip && (
                    <>
                      <span className={cx('gport', 'in', connectedIn.has(`${n.id}:${ip.id}`) && 'connected', portClass(ip, 'in'), hover?.node === n.id && hover.port === ip.id && 'hover')}
                        data-node={n.id} data-port={ip.id} data-side="in" style={{ ['--port-color' as any]: ip.color }}
                        onPointerDown={(e) => onPortDown(e, n, ip, 'in')} onContextMenu={(e) => onPortContext(e, ip.id, 'in')} title={ip.label || ip.type} />
                      {ip.label && <span className="gport-label">{ip.label}</span>}
                    </>
                  )}
                </div>
                <div className="gport-cell out">
                  {op && (
                    <>
                      {op.label && <span className="gport-label" title={op.label}>{op.label}</span>}
                      <span className={cx('gport', 'out', connectedOut.has(`${n.id}:${op.id}`) && 'connected', portClass(op, 'out'), hover?.node === n.id && hover.port === op.id && 'hover')}
                        data-node={n.id} data-port={op.id} data-side="out" style={{ ['--port-color' as any]: op.color }}
                        onPointerDown={(e) => onPortDown(e, n, op, 'out')} onContextMenu={(e) => onPortContext(e, op.id, 'out')} title={op.label || op.type} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {n.body && <div className="gnode-body">{n.body}</div>}
    </div>
  );
});

/** Fit a set of nodes into the canvas size. */
export function fitView(nodes: { x: number; y: number; width: number }[], w: number, h: number, pad = 80): View {
  if (!nodes.length) return { x: w / 2, y: h / 3, zoom: 1 };
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width)), maxY = Math.max(...nodes.map((n) => n.y + 140));
  const zoom = Math.max(0.2, Math.min(1.2, Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY))));
  return { zoom, x: (w - (maxX - minX) * zoom) / 2 - minX * zoom, y: (h - (maxY - minY) * zoom) / 2 - minY * zoom };
}
