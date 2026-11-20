import { useMemo, useRef, useState } from 'react';
import type { EffectGraph, EffectNode, Layer, SceneData, EffectPortDef, EffectParam } from '@vne/core';
import { newId } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { sceneOf, updateScene } from '../scene/sceneOps';
import { GraphCanvas, GNode, GEdge, View, fitView } from '../graph/GraphCanvas';
import { EFFECT_PRESETS } from './presets';
import { Button, IconButton, NumberInput, ColorInput, Select, Toggle, Empty, TextInput, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu, MenuItem } from '../ui/Menu';

const TYPE_COLORS: Record<string, string> = { image: '#e6b35a', number: '#6cc4ff', color: '#f08cc0', boolean: '#c48cff', select: '#9aa0b4', string: '#9aa0b4', layer: '#9aa0b4', prop: '#9aa0b4', variable: '#9aa0b4' };

function compatible(a: string, b: string): boolean {
  if (a === b) return true;
  if ((a === 'number' && b === 'boolean') || (a === 'boolean' && b === 'number')) return true;
  return false;
}

const CAT_ICONS: Record<string, string> = { input: 'jumpIn', output: 'jumpOut', color: 'palette', filter: 'filter', distort: 'wand', generate: 'sparkles', composite: 'layers', math: 'hash', value: 'variable', drive: 'link', module: 'module' };

export function EffectsPanel({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const scene = sceneOf(session, nodeId)!;
  const ui = session.sceneUI(nodeId);
  const layer = scene.layers.find((l) => l.id === ui.selectedLayers[0]);
  const [view, setView] = useState<View>({ x: 40, y: 30, zoom: 0.85 });
  const [sel, setSel] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
  const ref = useRef<HTMLDivElement>(null);
  const engine = session.engine;

  if (!layer) return <Empty icon="sparkles" title={t('effects.selectLayer')}>{t('effects.selectLayerText')}</Empty>;

  const linked = layer.effect?.kind === 'ref' ? session.project.effectGraphs.find((g) => g.id === (layer.effect as any).graphId) : null;
  const graph: EffectGraph | null = layer.effect?.kind === 'inline' ? layer.effect.graph : linked || null;

  /** Edit the graph wherever it lives (inline on the layer, or shared in the project library). */
  const edit = (label: string, fn: (g: EffectGraph) => void, mk?: string) => {
    session.update(label, (d) => {
      const s = d.nodes[nodeId].data as SceneData;
      const l = s.layers.find((x) => x.id === layer.id)!;
      if (l.effect?.kind === 'inline') fn(l.effect.graph);
      else if (l.effect?.kind === 'ref') { const g = d.effectGraphs.find((x) => x.id === (l.effect as any).graphId); if (g) fn(g); }
    }, mk ? { mergeKey: mk } : undefined);
  };

  const applyPreset = (id: string) => {
    const p = EFFECT_PRESETS.find((x) => x.id === id)!;
    updateScene(session, nodeId, t('effects.add'), (s) => { const l = s.layers.find((x) => x.id === layer.id)!; l.effect = { kind: 'inline', graph: p.make() }; });
    setTimeout(() => frame(), 30);
  };

  if (!graph) {
    return (
      <div className="effects-empty">
        <div className="preset-grid">
          {EFFECT_PRESETS.map((p) => <button key={p.id} type="button" className="preset" onClick={() => applyPreset(p.id)}><Icon name={p.id === 'empty' ? 'plus' : 'sparkles'} size={16} /><span>{t(p.label)}</span></button>)}
        </div>
        {session.project.effectGraphs.length > 0 && (
          <div className="row-inline">
            <span className="muted small">{t('effects.useShared')}</span>
            <Select value={null} placeholder={t('common.choose')} options={session.project.effectGraphs.map((g) => ({ value: g.id, label: g.name }))} onChange={(gid) => updateScene(session, nodeId, t('effects.link'), (s) => { s.layers.find((x) => x.id === layer.id)!.effect = { kind: 'ref', graphId: gid, params: {} }; })} />
          </div>
        )}
      </div>
    );
  }

  const nodeDefs = engine.effectNodes;
  const connectedIn = new Set(graph.edges.map((e) => `${e.to.node}:${e.to.port}`));
  const errors = (session as any).__fxErrors?.get?.(layer.id) as string[] | undefined;

  const gnodes: GNode[] = graph.nodes.map((n) => {
    const def = nodeDefs.get(n.type);
    const ins = (def?.inputs || []).filter((p) => !p.inlineOnly).map((p) => ({ id: p.id, label: t(p.label), type: p.type, color: TYPE_COLORS[p.type] || '#9aa0b4' }));
    const outs = (def?.outputs || []).map((p) => ({ id: p.id, label: t(p.label), type: p.type, color: TYPE_COLORS[p.type] || '#9aa0b4' }));
    const inline = (def?.inputs || []).filter((p) => p.inlineOnly || (!connectedIn.has(`${n.id}:${p.id}`) && p.type !== 'image'));
    return {
      id: n.id, x: n.x, y: n.y, width: n.type === 'fx.shader' ? 300 : 210,
      title: def ? t(def.label) : n.type, subtitle: def ? t(`fxcat.${def.category}`) : t('effects.missingNode'),
      color: def ? catColor(def.category) : '#ef5f6b', icon: CAT_ICONS[def?.category || 'module'] || 'sparkles',
      inputs: ins, outputs: outs, status: def ? null : 'error',
      body: inline.length ? <div className="fx-values" data-nodrag>{inline.map((p) => <FxValue key={p.id} port={p} node={n} layer={layer} scene={scene} session={session} graph={graph} onChange={(v, tr) => edit(t('effects.editValue'), (g) => { const x = g.nodes.find((y) => y.id === n.id)!; x.values = { ...x.values, [p.id]: v }; }, tr ? `fxv-${n.id}-${p.id}` : undefined)} />)}</div> : undefined,
    };
  });
  const gedges: GEdge[] = graph.edges.map((e) => {
    const from = graph.nodes.find((n) => n.id === e.from.node);
    const port = from && nodeDefs.get(from.type)?.outputs.find((p) => p.id === e.from.port);
    return { id: e.id, from: e.from, to: e.to, color: TYPE_COLORS[port?.type || 'image'] };
  });

  const portType = (nodeId2: string, port: string, side: 'in' | 'out') => {
    const n = graph.nodes.find((x) => x.id === nodeId2);
    const def = n && nodeDefs.get(n.type);
    return (side === 'in' ? def?.inputs : def?.outputs)?.find((p) => p.id === port)?.type;
  };

  const addNode = (type: string, at?: { x: number; y: number }, link?: { node: string; port: string; side: 'in' | 'out'; type: string }) => {
    const def = nodeDefs.get(type)!;
    const id = newId('fxn');
    const pos = at || { x: (200 - view.x) / view.zoom, y: (120 - view.y) / view.zoom };
    edit(t('effects.addNode'), (g) => {
      g.nodes.push({ id, type, x: Math.round(pos.x), y: Math.round(pos.y), values: {} });
      if (link) {
        if (link.side === 'out') { const ip = def.inputs.find((p) => !p.inlineOnly && compatible(link.type, p.type)); if (ip) { g.edges = g.edges.filter((e) => !(e.to.node === id && e.to.port === ip.id)); g.edges.push({ id: newId('fxe'), from: { node: link.node, port: link.port }, to: { node: id, port: ip.id } }); } }
        else { const op = def.outputs.find((p) => compatible(p.type, link.type)); if (op) { g.edges = g.edges.filter((e) => !(e.to.node === link.node && e.to.port === link.port)); g.edges.push({ id: newId('fxe'), from: { node: id, port: op.id }, to: { node: link.node, port: link.port } }); } }
      }
    });
    setSel({ nodes: [id], edges: [] });
  };

  const menuItems = (onPick: (type: string) => void, filter?: (d: any) => boolean): MenuItem[] => {
    const cats = ['color', 'filter', 'distort', 'generate', 'composite', 'value', 'math', 'drive', 'module', 'input', 'output'];
    const items: MenuItem[] = [];
    for (const c of cats) {
      const list = nodeDefs.list().filter((d) => (d.owner && d.owner !== 'core' ? 'module' : d.category) === c && (!filter || filter(d)));
      if (!list.length) continue;
      items.push({ header: true, label: t(`fxcat.${c}`) });
      for (const d of list) items.push({ label: t(d.label), icon: CAT_ICONS[c], onClick: () => onPick(d.id) });
    }
    return items;
  };

  const frame = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setView(fitView(graph.nodes.map((n) => ({ x: n.x, y: n.y, width: 220 })), r.width, r.height, 40));
  };

  const deleteSel = () => edit(t('effects.delete'), (g) => {
    g.nodes = g.nodes.filter((n) => !sel.nodes.includes(n.id));
    g.edges = g.edges.filter((e) => !sel.edges.includes(e.id) && !sel.nodes.includes(e.from.node) && !sel.nodes.includes(e.to.node));
  });

  return (
    <div className="effects-panel">
      <div className="fx-side">
        <div className="side-head"><span><Icon name="sparkles" size={13} /> {layer.name}</span></div>
        {linked ? (
          <div className="fx-shared"><Icon name="link" size={13} /> {t('effects.sharedGraph', { name: linked.name })}
            <Button small kind="ghost" onClick={() => updateScene(session, nodeId, t('effects.unlink'), (s) => { const l = s.layers.find((x) => x.id === layer.id)!; l.effect = { kind: 'inline', graph: JSON.parse(JSON.stringify(linked)) }; })}>{t('effects.makeLocal')}</Button>
          </div>
        ) : (
          <Button small icon="upload" kind="ghost" title={t('effects.shareHint')} onClick={async () => {
            const name = await store.prompt(t('effects.share'), t('common.name'), graph.name || layer.name);
            if (!name) return;
            const gid = newId('fxg');
            session.update(t('effects.share'), (d) => {
              const l = (d.nodes[nodeId].data as SceneData).layers.find((x) => x.id === layer.id)!;
              if (l.effect?.kind !== 'inline') return;
              d.effectGraphs.push({ ...JSON.parse(JSON.stringify(l.effect.graph)), id: gid, name });
              l.effect = { kind: 'ref', graphId: gid, params: {} };
            });
          }}>{t('effects.share')}</Button>
        )}
        <div className="row-label">{t('effects.params')}<IconButton icon="plus" size={13} title={t('effects.addParam')} onClick={() => edit(t('effects.addParam'), (g) => { g.params.push({ id: `p${g.params.length + 1}`, name: `Param ${g.params.length + 1}`, type: 'number', default: 1, min: 0, max: 10 }); })} /></div>
        {graph.params.map((p, i) => <ParamRow key={p.id} p={p} onChange={(np) => edit(t('effects.editParam'), (g) => { g.params[i] = np; })} onRemove={() => edit(t('effects.removeParam'), (g) => { g.params.splice(i, 1); })} t={t} />)}
        {!graph.params.length && <div className="muted small">{t('effects.paramsHint')}</div>}
        {errors?.length ? <div className="issue error"><Icon name="error" size={14} />{errors[0]}</div> : null}
        <div className="grow" />
        <Button small icon="trash" kind="ghost" onClick={() => updateScene(session, nodeId, t('effects.remove'), (s) => { s.layers.find((x) => x.id === layer.id)!.effect = null; })}>{t('effects.remove')}</Button>
      </div>
      <div className="fx-graph" ref={ref}>
        <GraphCanvas
          nodes={gnodes} edges={gedges} view={view} onView={setView} grid={10}
          selectedNodes={new Set(sel.nodes)} selectedEdges={new Set(sel.edges)}
          onSelect={(nodes, edges) => setSel({ nodes, edges })}
          onMove={(pos) => edit(t('effects.moveNodes'), (g) => { for (const p of pos) { const n = g.nodes.find((x) => x.id === p.id); if (n) { n.x = p.x; n.y = p.y; } } })}
          canConnect={(from, to) => {
            if (from.node === to.node) return t('graph.err.selfData');
            const a = portType(from.node, from.port, 'out'), b = portType(to.node, to.port, 'in');
            return a && b && compatible(a, b) ? true : t('graph.err.typeMismatch');
          }}
          onConnect={(from, to) => edit(t('graph.connect'), (g) => {
            g.edges = g.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port));
            g.edges.push({ id: newId('fxe'), from, to });
          })}
          onDetachEdge={(id) => edit(t('graph.disconnect'), (g) => { g.edges = g.edges.filter((e) => e.id !== id); })}
          onDropConnection={(from, world, screen) => openMenu(screen, menuItems((type) => addNode(type, world, from), (d) => (from.side === 'out' ? d.inputs : d.outputs).some((p: EffectPortDef) => !p.inlineOnly && (from.side === 'out' ? compatible(from.type, p.type) : compatible(p.type, from.type)))), { search: true })}
          onCanvasDoubleClick={(world, screen) => openMenu(screen, menuItems((type) => addNode(type, world)), { search: true })}
          onContextMenu={(target, e, world) => {
            if (target.kind === 'canvas') openMenu(e as any, menuItems((type) => addNode(type, world)), { search: true });
            else openMenu(e as any, [{ label: t('common.delete'), icon: 'trash', danger: true, onClick: deleteSel }]);
          }}
          onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); } if (e.key === 'f') frame(); }}
          portsCompatible={(a, b) => compatible(a.type, b.type)}
          ariaLabel={t('effects.graph')}
        />
        <div className="graph-toolbar small">
          <Button small icon="plus" onClick={(e) => openMenu(e, menuItems((type) => addNode(type)), { search: true })}>{t('effects.addNode')}</Button>
          <IconButton icon="fit" size={14} title={t('graph.frameAll')} onClick={frame} />
        </div>
      </div>
    </div>
  );
}

function catColor(c: string): string {
  return ({ input: '#3ecf8e', output: '#3ecf8e', color: '#f08cc0', filter: '#e6b35a', distort: '#b48cf0', generate: '#f2a65a', composite: '#6c8cff', math: '#6cc4ff', value: '#4fc3c8', drive: '#ef8f5f', module: '#25a89c' } as Record<string, string>)[c] || '#8fa3bf';
}

function ParamRow({ p, onChange, onRemove, t }: { p: EffectParam; onChange: (p: EffectParam) => void; onRemove: () => void; t: (k: string) => string }) {
  return (
    <div className="param-row">
      <TextInput value={p.name} onChange={(v) => onChange({ ...p, name: v })} ariaLabel={t('common.name')} />
      <code className="muted small" title={t('effects.paramId')}>{p.id}</code>
      <Select value={p.type} options={[{ value: 'number', label: t('vars.number') }, { value: 'color', label: t('prop.color') }, { value: 'boolean', label: t('vars.boolean') }]} onChange={(v) => onChange({ ...p, type: v as any, default: v === 'number' ? 1 : v === 'color' ? '#ffffff' : false })} />
      <IconButton icon="close" size={12} title={t('common.remove')} onClick={onRemove} />
    </div>
  );
}

function FxValue({ port, node, layer, scene, session, graph, onChange }: { port: EffectPortDef; node: EffectNode; layer: Layer; scene: SceneData; session: ProjectSession; graph: EffectGraph; onChange: (v: any, transient?: boolean) => void }) {
  const t = session.i18n.t;
  const v = node.values?.[port.id] ?? port.default;
  let control: React.ReactNode = null;
  switch (port.type) {
    case 'number': control = <NumberInput value={Number(v ?? 0)} min={port.min} max={port.max} step={port.step ?? 0.1} onChange={onChange} />; break;
    case 'color': control = <ColorInput value={String(v ?? '#ffffff')} onChange={onChange} />; break;
    case 'boolean': control = <Toggle value={!!v} onChange={(x) => onChange(x)} />; break;
    case 'select': control = <Select value={v} options={(port.options || []).map((o) => ({ value: o.value, label: t(o.label) }))} onChange={(x) => onChange(x)} />; break;
    case 'layer': control = <Select value={v || ''} options={[{ value: '', label: t('effects.thisLayer') }, ...scene.layers.filter((l) => l.id !== layer.id).map((l) => ({ value: l.id, label: l.name }))]} onChange={(x) => onChange(x)} />; break;
    case 'prop': {
      const target = scene.layers.find((l) => l.id === node.values?.layer) || layer;
      control = <Select value={v} options={session.engine.layerProps(target.type).filter((p) => p.type === 'number' || p.type === 'color').map((p) => ({ value: p.key, label: t(p.label) }))} onChange={(x) => onChange(x)} />;
      break;
    }
    case 'variable': control = <Select value={v || ''} placeholder={t('vars.choose')} options={session.project.variables.map((x) => ({ value: x.id, label: x.name }))} onChange={(x) => onChange(x)} />; break;
    case 'string':
      if (port.id === 'param') control = <Select value={v || ''} placeholder={t('effects.chooseParam')} options={graph.params.map((p) => ({ value: p.id, label: p.name }))} onChange={(x) => onChange(x)} />;
      else if (port.id === 'code') control = <textarea className={cx('input', 'code')} rows={7} defaultValue={String(v ?? '')} spellCheck={false} onBlur={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
      else control = <TextInput value={String(v ?? '')} onChange={(x) => onChange(x)} />;
      break;
    default: return null;
  }
  return <label className="fx-value"><span>{t(port.label)}</span>{control}</label>;
}

export { useMemo };
