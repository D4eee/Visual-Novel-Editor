import { useEffect, useMemo, useRef, useCallback } from 'react';
import type { StoryNode, SceneData, JumpData, Project } from '@vne/core';
import { createNode, connect, canConnect, deleteNodes, copyNodes, pasteNodes, nodePorts, isFlowPort, typesCompatible, jumpOutsFor, nodesInChapter, createSceneData, nextSceneNumber } from '@vne/core';
import { GraphCanvas, fitView, View, GPort } from '../graph/GraphCanvas';
import { toGNode, toGEdges, NODE_WIDTH } from './nodeModel';
import type { ProjectSession } from '../state/session';
import { store, useSession, useT } from '../state/store';
import { openMenu, MenuItem } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { IconButton, Button, shortcut, cx } from '../ui/controls';

const QUICK = ['core.scene', 'core.condition', 'core.event', 'core.jumpIn', 'core.jumpOut', 'core.ending'];

export function nodeCreationItems(session: ProjectSession, t: (k: string, p?: any) => string, onPick: (type: string) => void, filter?: (type: string) => boolean): MenuItem[] {
  const engine = session.engine;
  const project = session.project;
  const hasStart = Object.values(project.nodes).some((n) => n.type === 'core.start');
  const defs = engine.nodeTypes.list().filter((d) => d.creatable !== false && (!filter || filter(d.id)) && !(d.unique && hasStart && d.id === 'core.start'));
  const cats: [string, string][] = [['scene', 'nodecat.scene'], ['flow', 'nodecat.flow'], ['logic', 'nodecat.logic'], ['organize', 'nodecat.organize'], ['module', 'nodecat.module']];
  const items: MenuItem[] = [];
  for (const [cat, label] of cats) {
    const list = defs.filter((d) => (d.owner && d.owner !== 'core' ? 'module' : d.category) === cat);
    if (!list.length) continue;
    items.push({ header: true, label: t(label) });
    for (const d of list) items.push({ label: t(d.label), icon: d.icon || 'module', hint: d.description ? t(d.description) : undefined, onClick: () => onPick(d.id) });
  }
  return items;
}

export function StoryGraph({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const project = session.project;
  const engine = session.engine;
  const ui = session.ui;
  const ref = useRef<HTMLDivElement>(null);
  const chapterIdx = project.chapters.findIndex((c) => c.id === ui.chapterId);
  const chapter = project.chapters[chapterIdx] || project.chapters[0];
  const viewKey = ui.overview ? '__overview' : chapter.id;
  const view: View = ui.views[viewKey] || { x: 120, y: 80, zoom: 1 };

  // Overview lays chapters side by side.
  const offsets = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    if (!ui.overview) { m.set(chapter.id, { x: 0, y: 0 }); return m; }
    let x = 0;
    for (const c of project.chapters) {
      const nodes = nodesInChapter(project, c.id);
      const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) : 0;
      const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x + NODE_WIDTH)) : 400;
      m.set(c.id, { x: x - minX, y: 60 });
      x += maxX - minX + 360;
    }
    return m;
  }, [ui.overview, project.nodes, project.chapters, chapter.id]);

  const shownNodes = useMemo(() => Object.values(project.nodes).filter((n) => offsets.has(n.chapterId)), [project.nodes, offsets]);
  const shownIds = useMemo(() => new Set(shownNodes.map((n) => n.id)), [shownNodes]);
  const gnodes = useMemo(() => shownNodes.map((n) => {
    const g = toGNode(engine, project, n, t, session.issues, offsets.get(n.chapterId));
    // annotate outputs that lead to another chapter
    g.outputs = g.outputs.map((p) => {
      const e = project.edges.find((x) => x.from.node === n.id && x.from.port === p.id);
      if (e && !shownIds.has(e.to.node)) {
        const to = project.nodes[e.to.node];
        const ch = project.chapters.find((c) => c.id === to?.chapterId);
        return { ...p, label: `${p.label ? p.label + ' ' : ''}→ ${ch?.name || '?'}` };
      }
      return p;
    });
    return g;
  }), [shownNodes, project, engine, t, session.issues, offsets, shownIds]);
  const gedges = useMemo(() => toGEdges(engine, project, shownIds), [engine, project, shownIds]);

  const setView = useCallback((v: View) => {
    session.setUI((u) => ({ views: { ...u.views, [viewKey]: v } }));
  }, [session, viewKey]);

  // The first time a chapter (or the overview) is shown, frame all of its nodes.
  useEffect(() => {
    if (ui.views[viewKey] || !gnodes.length) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    const v = fitView(gnodes, r.width, r.height);
    // Large chapters: keep nodes readable and start from the left (where the story begins).
    const MIN = 0.6;
    if (v.zoom < MIN) {
      const minX = Math.min(...gnodes.map((n) => n.x)), minY = Math.min(...gnodes.map((n) => n.y)), maxY = Math.max(...gnodes.map((n) => n.y + 140));
      setView({ zoom: MIN, x: 60 - minX * MIN, y: Math.max(60, (r.height - (maxY - minY) * MIN) / 2) - minY * MIN });
    } else setView(v);
  }, [viewKey, gnodes.length > 0]);

  // Center on a node when asked (search, problems list, "reveal in graph").
  useEffect(() => {
    const f = ui.graphFocus;
    if (!f || !ref.current) return;
    const n = project.nodes[f.nodeId];
    if (!n) return;
    const off = offsets.get(n.chapterId) || { x: 0, y: 0 };
    const r = ref.current.getBoundingClientRect();
    const zoom = Math.max(0.8, view.zoom);
    setView({ zoom, x: r.width / 2 - (n.x + off.x + NODE_WIDTH / 2) * zoom, y: r.height / 2 - (n.y + off.y + 60) * zoom });
  }, [ui.graphFocus?.key]);

  const toLocal = (id: string, x: number, y: number) => {
    const n = project.nodes[id];
    const off = offsets.get(n?.chapterId || '') || { x: 0, y: 0 };
    return { x: x - off.x, y: y - off.y };
  };

  const addNode = (type: string, world: { x: number; y: number }, link?: { node: string; port: string; side: 'in' | 'out' }) => {
    let created: string | null = null;
    const targetChapter = ui.overview ? (link ? project.nodes[link.node]?.chapterId : chapter.id) || chapter.id : chapter.id;
    const off = offsets.get(targetChapter) || { x: 0, y: 0 };
    session.update(t('graph.addNode'), (d) => {
      const n = createNode(engine, d, type, targetChapter, Math.round((world.x - off.x) / 16) * 16, Math.round((world.y - off.y - 17) / 16) * 16);
      if (type === 'core.scene') n.name = `${t('node.scene')} ${(n.data as SceneData).number}`;
      else n.name = t(engine.nodeTypes.get(type)?.label || type);
      d.nodes[n.id] = n;
      created = n.id;
      if (link) {
        const ports = nodePorts(engine, d, n);
        if (link.side === 'out') { const ip = ports.inputs[0]; if (ip) connect(engine, d, { node: link.node, port: link.port }, { node: n.id, port: ip.id }); }
        else { const op = ports.outputs[0]; if (op) connect(engine, d, { node: n.id, port: op.id }, { node: link.node, port: link.port }); }
      }
    });
    if (created) session.setUI({ selection: { nodes: [created], edges: [] } });
    return created;
  };

  const creationMenuAt = (screen: { x: number; y: number }, world: { x: number; y: number }, link?: { node: string; port: string; side: 'in' | 'out'; type: string }) => {
    const filter = link ? (type: string) => {
      const probe = { id: 'probe', type, chapterId: chapter.id, name: '', x: 0, y: 0, data: engine.nodeTypes.get(type)!.createData(project), modules: [] } as StoryNode;
      const ports = nodePorts(engine, { ...project, nodes: { ...project.nodes, probe } } as Project, probe);
      return (link.side === 'out' ? ports.inputs : ports.outputs).some((p) => (link.side === 'out' ? typesCompatible(engine, link.type, p.type) : typesCompatible(engine, p.type, link.type)));
    } : undefined;
    openMenu(screen, nodeCreationItems(session, t, (type) => addNode(type, world, link), filter), { search: true, title: link ? t('graph.createConnected') : t('graph.addNode') });
  };

  const center = () => {
    const r = ref.current?.getBoundingClientRect();
    return { x: ((r?.width || 800) / 2 - view.x) / view.zoom - NODE_WIDTH / 2, y: ((r?.height || 600) / 2 - view.y) / view.zoom - 40 };
  };

  const deleteSelection = () => {
    const nodes = ui.selection.nodes.filter((id) => project.nodes[id]);
    const edges = ui.selection.edges;
    if (!nodes.length && !edges.length) return;
    session.update(nodes.length ? t('graph.deleteNodes', { n: nodes.length }) : t('graph.deleteEdge'), (d) => {
      if (nodes.length) deleteNodes(d, nodes);
      if (edges.length) d.edges = d.edges.filter((e) => !edges.includes(e.id));
    });
    session.setUI({ selection: { nodes: [], edges: [] }, tabs: session.ui.tabs.filter((tb) => tb.kind !== 'node' || !nodes.includes(tb.nodeId)), active: 0 });
  };

  const copy = () => {
    if (!ui.selection.nodes.length) return;
    store.clipboard = { kind: 'nodes', data: copyNodes(project, ui.selection.nodes) };
    try { navigator.clipboard?.writeText(JSON.stringify(store.clipboard.data)).catch(() => {}); } catch { /* ignore */ }
    store.toast(t('graph.copied', { n: ui.selection.nodes.length }));
  };

  const paste = (at?: { x: number; y: number }) => {
    const clip = store.clipboard?.kind === 'nodes' ? store.clipboard.data : null;
    if (!clip?.nodes?.length) return;
    const minX = Math.min(...clip.nodes.map((n: StoryNode) => n.x)), minY = Math.min(...clip.nodes.map((n: StoryNode) => n.y));
    const target = at || { x: minX + 48, y: minY + 48 };
    let ids: string[] = [];
    session.update(t('graph.paste'), (d) => { ids = pasteNodes(d, clip, chapter.id, { x: target.x - minX, y: target.y - minY }); });
    session.setUI({ selection: { nodes: ids, edges: [] } });
  };

  const duplicate = () => { copy(); paste(); };

  const nodeMenu = (id: string, e: { clientX: number; clientY: number }) => {
    const n = project.nodes[id];
    if (!n) return;
    const many = ui.selection.nodes.length > 1;
    const items: MenuItem[] = [];
    if (!many) {
      items.push({ label: n.type === 'core.scene' ? t('graph.openScene') : t('graph.openNode'), icon: 'arrowRight', shortcut: 'Enter', onClick: () => session.openNode(id) });
      items.push({ label: t('preview.fromHere'), icon: 'play', onClick: () => session.setUI({ preview: { scope: 'scene', nodeId: id, key: Date.now() } }) });
      items.push({ label: t('common.rename'), icon: 'text', shortcut: 'F2', onClick: async () => { const v = await store.prompt(t('common.rename'), t('common.name'), n.name); if (v !== null) session.update(t('common.rename'), (d) => { d.nodes[id].name = v; }); } });
      items.push({ label: t('modules.addToNode'), icon: 'module', onClick: () => session.openNode(id, 'modules') });
    }
    items.push({ separator: true });
    items.push({ label: t('common.duplicate'), icon: 'duplicate', shortcut: shortcut('Mod+D'), onClick: duplicate });
    items.push({ label: t('common.copy'), icon: 'copy', shortcut: shortcut('Mod+C'), onClick: copy });
    items.push({ label: t('graph.moveToChapter'), icon: 'book', submenu: project.chapters.filter((c) => c.id !== n.chapterId).map((c) => ({ label: c.name, onClick: () => {
      const ids = ui.selection.nodes.length ? ui.selection.nodes : [id];
      session.update(t('graph.moveToChapter'), (d) => { for (const nid of ids) if (d.nodes[nid]) d.nodes[nid].chapterId = c.id; });
      store.toast(t('graph.moved', { n: ids.length, chapter: c.name }), 'success', { label: t('graph.goThere'), run: () => session.setUI({ chapterId: c.id, overview: false }) });
    } })) });
    if (!many) {
      items.push({ label: t('graph.setEntry'), icon: 'flag', checked: chapter.entryNodeId === id, onClick: () => session.update(t('graph.setEntry'), (d) => { const ch = d.chapters.find((c) => c.id === n.chapterId); if (ch) ch.entryNodeId = ch.entryNodeId === id ? null : id; }) });
      if (n.type === 'core.jumpIn') {
        const num = (n.data as JumpData).number;
        const outs = jumpOutsFor(project, num);
        if (outs.length) items.push({ label: t('jump.goToOut'), icon: 'jumpOut', onClick: () => session.focusNode(outs[0].id) });
        else items.push({ label: t('jump.createOut'), icon: 'jumpOut', submenu: project.chapters.map((c) => ({ label: c.name, onClick: () => {
          let nid = '';
          session.update(t('jump.createOut'), (d) => {
            const o = createNode(engine, d, 'core.jumpOut', c.id, c.id === n.chapterId ? n.x + 300 : 80, c.id === n.chapterId ? n.y : 80);
            (o.data as JumpData).number = num;
            o.name = `${t('node.jumpOut')} #${num}`;
            d.nodes[o.id] = o;
            nid = o.id;
          });
          if (c.id !== n.chapterId) store.toast(t('jump.createdIn', { chapter: c.name }), 'success', { label: t('graph.goThere'), run: () => session.focusNode(nid) });
        } })) });
      }
      if (n.type === 'core.jumpOut') {
        const ins = Object.values(project.nodes).filter((x) => x.type === 'core.jumpIn' && (x.data as JumpData).number === (n.data as JumpData).number);
        if (ins.length) items.push({ label: t('jump.showIns', { n: ins.length }), icon: 'jumpIn', submenu: ins.map((x) => ({ label: `${project.chapters.find((c) => c.id === x.chapterId)?.name} · ${x.name}`, onClick: () => session.focusNode(x.id) })) });
      }
    }
    items.push({ separator: true });
    items.push({ label: t('common.delete'), icon: 'trash', danger: true, shortcut: 'Del', onClick: deleteSelection, disabled: n.type === 'core.start' && !many && false });
    openMenu(e, items);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
    else if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
    else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); session.setUI({ selection: { nodes: shownNodes.map((n) => n.id), edges: [] } }); }
    else if (e.key === 'Enter' && ui.selection.nodes.length === 1) { e.preventDefault(); session.openNode(ui.selection.nodes[0]); }
    else if (e.key === 'F2' && ui.selection.nodes.length === 1) { e.preventDefault(); nodeMenu(ui.selection.nodes[0], { clientX: 200, clientY: 200 }); }
    else if (e.key === 'f' && !mod) { e.preventDefault(); frame(); }
    else if (e.key === 'Tab' || (e.key === 'a' && e.shiftKey)) { e.preventDefault(); const r = ref.current!.getBoundingClientRect(); creationMenuAt({ x: r.left + r.width / 2 - 100, y: r.top + 120 }, center()); }
  };

  const frame = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const sel = gnodes.filter((n) => ui.selection.nodes.includes(n.id));
    setView(fitView(sel.length ? sel : gnodes, r.width, r.height));
  };

  const portsCompatible = (a: GPort, b: GPort) => typesCompatible(engine, a.type, b.type);

  return (
    <div className="story-graph" ref={ref}>
      <GraphCanvas
        nodes={gnodes}
        edges={gedges}
        view={view}
        onView={setView}
        selectedNodes={new Set(ui.selection.nodes)}
        selectedEdges={new Set(ui.selection.edges)}
        onSelect={(nodes, edges) => session.setUI({ selection: { nodes, edges } })}
        onMove={(pos) => session.update(t('graph.moveNodes'), (d) => { for (const p of pos) { const l = toLocal(p.id, p.x, p.y); if (d.nodes[p.id]) { d.nodes[p.id].x = l.x; d.nodes[p.id].y = l.y; } } })}
        onConnect={(from, to) => session.update(t('graph.connect'), (d) => { connect(engine, d, from, to); })}
        canConnect={(from, to) => { const r = canConnect(engine, project, from, to); return r.ok ? true : t(r.reason); }}
        onDetachEdge={(id) => session.update(t('graph.disconnect'), (d) => { d.edges = d.edges.filter((e) => e.id !== id); })}
        onDropConnection={(from, world, screen) => creationMenuAt(screen, world, from)}
        onNodeDoubleClick={(id) => session.openNode(id)}
        onCanvasDoubleClick={(world, screen) => creationMenuAt(screen, { x: world.x - NODE_WIDTH / 2, y: world.y })}
        onContextMenu={(target, e, world) => {
          if (target.kind === 'node' && target.id) nodeMenu(target.id, e as any);
          else if (target.kind === 'edge' && target.id) openMenu(e as any, [{ label: t('graph.deleteEdge'), icon: 'unlink', danger: true, onClick: () => session.update(t('graph.deleteEdge'), (d) => { d.edges = d.edges.filter((x) => x.id !== target.id); }) }]);
          else if (target.kind === 'port' && target.id) openMenu(e as any, [{ label: t('graph.disconnectPort'), icon: 'unlink', onClick: () => session.update(t('graph.disconnect'), (d) => { d.edges = d.edges.filter((x) => !(target.side === 'out' ? x.from.node === target.id && x.from.port === target.port : x.to.node === target.id && x.to.port === target.port)); }) }]);
          else openMenu(e as any, [
            { label: t('graph.addNode'), icon: 'plus', submenu: nodeCreationItems(session, t, (type) => addNode(type, world)) },
            { label: t('common.paste'), icon: 'paste', shortcut: shortcut('Mod+V'), disabled: store.clipboard?.kind !== 'nodes', onClick: () => paste(world) },
            { separator: true },
            { label: t('graph.selectAll'), shortcut: shortcut('Mod+A'), onClick: () => session.setUI({ selection: { nodes: shownNodes.map((n) => n.id), edges: [] } }) },
            { label: t('graph.frameAll'), icon: 'fit', shortcut: 'F', onClick: frame },
          ]);
        }}
        onKeyDown={onKeyDown}
        portsCompatible={portsCompatible}
        ariaLabel={t('graph.aria')}
        emptyHint={<div className="graph-empty-card"><Icon name="workflow" size={28} /><div className="empty-title">{t('graph.emptyTitle')}</div><div>{t('graph.emptyText')}</div><Button kind="primary" icon="plus" onClick={() => addNode('core.scene', center())}>{t('graph.addScene')}</Button></div>}
      />
      <div className="graph-toolbar">
        <div className="graph-title">
          <Icon name={ui.overview ? 'book' : 'workflow'} size={15} />
          <span>{ui.overview ? t('graph.overview') : chapter.name}</span>
        </div>
        <div className="graph-quick" role="toolbar" aria-label={t('graph.quickAdd')}>
          {QUICK.filter((q) => engine.nodeTypes.has(q)).map((q) => {
            const def = engine.nodeTypes.get(q)!;
            return (
              <button key={q} type="button" className="quick-node" style={{ ['--node-color' as any]: def.color }} onClick={() => addNode(q, center())} title={def.description ? t(def.description) : t(def.label)} draggable={false}>
                <Icon name={def.icon || 'module'} size={14} /><span>{t(def.label)}</span>
              </button>
            );
          })}
          <IconButton icon="more" title={t('graph.moreNodes')} onClick={(e) => openMenu(e, nodeCreationItems(session, t, (type) => addNode(type, center())), { search: true })} />
        </div>
      </div>
      <div className="graph-zoom">
        <IconButton icon="minus" title={t('graph.zoomOut')} onClick={() => setView({ ...view, zoom: Math.max(0.15, view.zoom / 1.2) })} />
        <span className="zoom-label">{Math.round(view.zoom * 100)}%</span>
        <IconButton icon="plus" title={t('graph.zoomIn')} onClick={() => setView({ ...view, zoom: Math.min(2.5, view.zoom * 1.2) })} />
        <IconButton icon="fit" title={`${t('graph.frameAll')} (F)`} onClick={frame} />
        <IconButton icon="book" title={t('graph.toggleOverview')} active={ui.overview} onClick={() => session.setUI({ overview: !ui.overview })} />
      </div>
      <div className={cx('graph-hint', 'muted')}>{t('graph.hint')}</div>
    </div>
  );
}

export { createSceneData, nextSceneNumber };
