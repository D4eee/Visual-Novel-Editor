import type { Engine } from './registry';
import type { Block, Issue, JumpData, Project, SceneData, StoryNode, Layer, EventData, ConditionData, Expr } from './types';
import { nodePorts, isFlowPort, jumpOutsFor, jumpInsFor, reachableFrom, typesCompatible } from './graph';
import { exprVars, isExpr } from './expr';

export interface ValidationEnv {
  /** Asset ids whose files are missing on disk. */
  missingAssets?: Set<string>;
  /** Status of the project's module dependencies. */
  moduleStatus?: Map<string, { status: 'ok' | 'missing' | 'incompatible' | 'disabled' | 'failed'; detail?: string }>;
}

/** Module id that owns a namespaced type id ("com.example.mod/thing" → "com.example.mod"). */
export function ownerOfType(typeId: string): string | null {
  if (!typeId || typeId.startsWith('core.')) return null;
  const i = typeId.indexOf('/');
  return i > 0 ? typeId.slice(0, i) : null;
}

export function validateProject(engine: Engine, project: Project, env: ValidationEnv = {}): Issue[] {
  const issues: Issue[] = [];
  const nodes = Object.values(project.nodes);
  const nodeLabel = (n: StoryNode) => n.name || n.id;
  const varIds = new Set(project.variables.map((v) => v.id));
  const assetIds = new Set(project.assets.map((a) => a.id));

  /* Start node ------------------------------------------------------- */
  const starts = nodes.filter((n) => n.type === 'core.start');
  if (starts.length === 0) issues.push({ severity: 'error', code: 'start.missing', message: 'issue.start.missing' });
  if (starts.length > 1) for (const s of starts.slice(1)) issues.push({ severity: 'error', code: 'start.multiple', message: 'issue.start.multiple', target: { nodeId: s.id, chapterId: s.chapterId } });
  if (starts[0] && !project.edges.some((e) => e.from.node === starts[0].id)) {
    issues.push({ severity: 'error', code: 'start.unconnected', message: 'issue.start.unconnected', target: { nodeId: starts[0].id, chapterId: starts[0].chapterId } });
  }

  /* Duplicate ids ------------------------------------------------------ */
  const seen = new Map<string, string>();
  const checkId = (id: string, what: string, nodeId?: string) => {
    if (!id) return;
    if (seen.has(id)) issues.push({ severity: 'error', code: 'id.duplicate', message: 'issue.id.duplicate', params: { id, what }, target: { nodeId } });
    else seen.set(id, what);
  };
  for (const n of nodes) {
    checkId(n.id, 'node', n.id);
    if (n.type === 'core.scene') {
      const d = n.data as SceneData;
      d.layers?.forEach((l) => checkId(l.id, 'layer', n.id));
      d.choices?.forEach((c) => checkId(c.id, 'choice', n.id));
      d.animations?.forEach((a) => checkId(a.id, 'animation', n.id));
      d.dialogue?.forEach((l) => checkId(l.id, 'line', n.id));
    }
    n.modules?.forEach((m) => checkId(m.id, 'module instance', n.id));
  }
  project.assets.forEach((a) => checkId(a.id, 'asset'));
  project.variables.forEach((v) => checkId(v.id, 'variable'));
  project.chapters.forEach((c) => checkId(c.id, 'chapter'));

  /* Node types and modules -------------------------------------------- */
  const reportedModules = new Set<string>();
  const missingType = (typeId: string, kind: string, nodeId?: string, chapterId?: string) => {
    const owner = ownerOfType(typeId);
    const key = `${owner}:${typeId}`;
    if (reportedModules.has(key)) return;
    reportedModules.add(key);
    issues.push({ severity: 'error', code: 'module.typeMissing', message: owner ? 'issue.module.typeMissing' : 'issue.type.unknown', params: { type: typeId, kind, module: owner || '?' }, target: { nodeId, chapterId, moduleId: owner || undefined } });
  };

  for (const dep of project.modules) {
    const st = env.moduleStatus?.get(dep.id);
    if (!dep.enabled) continue;
    if (!st || st.status === 'missing') issues.push({ severity: 'error', code: 'module.missing', message: 'issue.module.missing', params: { module: dep.id, version: dep.version }, target: { moduleId: dep.id } });
    else if (st.status === 'incompatible') issues.push({ severity: 'error', code: 'module.incompatible', message: 'issue.module.incompatible', params: { module: dep.id, detail: st.detail || '' }, target: { moduleId: dep.id } });
    else if (st.status === 'failed') issues.push({ severity: 'error', code: 'module.failed', message: 'issue.module.failed', params: { module: dep.id, detail: st.detail || '' }, target: { moduleId: dep.id } });
  }

  /* Edges ------------------------------------------------------------- */
  for (const e of project.edges) {
    const a = project.nodes[e.from.node];
    const b = project.nodes[e.to.node];
    if (!a || !b) {
      issues.push({ severity: 'error', code: 'edge.broken', message: 'issue.edge.broken', target: { edgeId: e.id, nodeId: (a || b)?.id } });
      continue;
    }
    if (!engine.nodeTypes.has(a.type) || !engine.nodeTypes.has(b.type)) continue;
    const op = nodePorts(engine, project, a).outputs.find((p) => p.id === e.from.port);
    const ip = nodePorts(engine, project, b).inputs.find((p) => p.id === e.to.port);
    if (!op || !ip) issues.push({ severity: 'error', code: 'edge.port', message: 'issue.edge.port', params: { node: nodeLabel(!op ? a : b) }, target: { edgeId: e.id, nodeId: (!op ? a : b).id, chapterId: (!op ? a : b).chapterId } });
    else if (!typesCompatible(engine, op.type, ip.type)) issues.push({ severity: 'error', code: 'edge.type', message: 'issue.edge.type', params: { from: op.type, to: ip.type }, target: { edgeId: e.id, nodeId: b.id, chapterId: b.chapterId } });
  }

  /* Per-node checks ----------------------------------------------------- */
  const reachable = starts[0] ? reachableFrom(project, starts[0].id) : new Set<string>();
  for (const n of nodes) {
    const def = engine.nodeTypes.get(n.type);
    const target = { nodeId: n.id, chapterId: n.chapterId };
    if (!def) { missingType(n.type, 'node', n.id, n.chapterId); continue; }
    // Pure data nodes (no flow input) are pulled by the nodes they feed, so reachability does not apply.
    const hasFlowInput = (() => { try { return nodePorts(engine, project, n).inputs.some((pt) => isFlowPort(engine, pt)); } catch { return true; } })();
    if (hasFlowInput && n.type !== 'core.comment' && n.type !== 'core.start' && n.type !== 'core.jumpOut' && starts[0] && !reachable.has(n.id)) {
      issues.push({ severity: 'warning', code: 'node.unreachable', message: 'issue.node.unreachable', params: { node: nodeLabel(n) }, target });
    }
    const ports = nodePorts(engine, project, n);
    for (const p of ports.outputs) {
      if (!isFlowPort(engine, p)) continue;
      if (!project.edges.some((e) => e.from.node === n.id && e.from.port === p.id)) {
        issues.push({ severity: 'warning', code: 'port.open', message: 'issue.port.open', params: { node: nodeLabel(n), port: p.label || p.id }, target });
      }
    }
    for (const p of ports.inputs) {
      if (isFlowPort(engine, p)) continue;
      if (!project.edges.some((e) => e.to.node === n.id && e.to.port === p.id)) {
        issues.push({ severity: 'info', code: 'port.dataOpen', message: 'issue.port.dataOpen', params: { node: nodeLabel(n), port: p.label || p.id }, target });
      }
    }
    if (n.type === 'core.jumpIn') {
      const num = (n.data as JumpData).number;
      const outs = jumpOutsFor(project, num);
      if (outs.length === 0) issues.push({ severity: 'error', code: 'jump.missing', message: 'issue.jump.missing', params: { number: num }, target });
      if (outs.length > 1) issues.push({ severity: 'error', code: 'jump.ambiguous', message: 'issue.jump.ambiguous', params: { number: num, count: outs.length }, target });
    }
    if (n.type === 'core.jumpOut') {
      const num = (n.data as JumpData).number;
      if (jumpInsFor(project, num).length === 0) issues.push({ severity: 'warning', code: 'jump.unused', message: 'issue.jump.unused', params: { number: num }, target });
      if (jumpOutsFor(project, num).length > 1) issues.push({ severity: 'error', code: 'jump.duplicateOut', message: 'issue.jump.duplicateOut', params: { number: num }, target });
    }
    if (n.type === 'core.condition') {
      const d = n.data as ConditionData;
      if (!d.expr) issues.push({ severity: 'warning', code: 'condition.empty', message: 'issue.condition.empty', params: { node: nodeLabel(n) }, target });
      checkVars(d.expr, varIds, n, issues);
    }
    if (n.type === 'core.event') checkBlocks(engine, (n.data as EventData).actions, n, null, varIds, issues, missingType);
    if (n.type === 'core.scene') checkScene(engine, project, n, varIds, assetIds, issues, missingType, env);
    for (const m of n.modules || []) {
      const c = engine.components.get(m.component);
      if (!c) { missingType(m.component, 'component', n.id, n.chapterId); continue; }
      if (c.validate) {
        try { issues.push(...c.validate(m.data, n, project).map((i) => ({ ...i, target: { ...target, ...i.target } }))); }
        catch (err: any) { issues.push({ severity: 'error', code: 'module.validateFailed', message: 'issue.module.validateFailed', params: { module: m.moduleId, detail: String(err?.message || err) }, target }); }
      }
    }
    if (def.validate) {
      try { issues.push(...def.validate(n, project).map((i) => ({ ...i, target: { ...target, ...i.target } }))); }
      catch (err: any) { issues.push({ severity: 'error', code: 'node.validateFailed', message: 'issue.node.validateFailed', params: { node: nodeLabel(n), detail: String(err?.message || err) }, target }); }
    }
  }

  /* Assets ------------------------------------------------------------- */
  if (env.missingAssets) {
    for (const a of project.assets) if (env.missingAssets.has(a.id)) issues.push({ severity: 'error', code: 'asset.missingFile', message: 'issue.asset.missingFile', params: { name: a.name, path: a.path }, target: { assetId: a.id } });
  }
  for (const c of project.characters) for (const p of c.portraits) if (p.assetId && !assetIds.has(p.assetId)) {
    issues.push({ severity: 'error', code: 'asset.missingRef', message: 'issue.asset.portrait', params: { name: `${c.name} / ${p.name}` } });
  }
  return issues;
}

function checkVars(expr: Expr | null | undefined, varIds: Set<string>, n: StoryNode, issues: Issue[], local?: Set<string>) {
  for (const v of exprVars(expr)) {
    if (!varIds.has(v) && !local?.has(v)) issues.push({ severity: 'error', code: 'var.missing', message: 'issue.var.missing', params: { node: n.name }, target: { nodeId: n.id, chapterId: n.chapterId } });
  }
}

function checkBlocks(engine: Engine, blocks: Block[] | undefined, n: StoryNode, scene: SceneData | null, varIds: Set<string>, issues: Issue[], missingType: (t: string, k: string, nodeId?: string, chapterId?: string) => void, local?: Set<string>) {
  const layerIds = new Set((scene?.layers || []).map((l) => l.id));
  const animIds = new Set((scene?.animations || []).map((a) => a.id));
  const walk = (list: Block[] | undefined) => {
    for (const b of list || []) {
      if (!b) continue;
      const def = engine.blocks.get(b.type);
      if (!def) { missingType(b.type, 'block', n.id, n.chapterId); continue; }
      for (const a of def.args) {
        const v = b.args?.[a.id];
        if (a.type === 'layer' && scene && v && !layerIds.has(String(v))) issues.push({ severity: 'error', code: 'script.layer', message: 'issue.script.layer', params: { node: n.name }, target: { nodeId: n.id, chapterId: n.chapterId } });
        if (a.type === 'animation' && scene && v && !animIds.has(String(v))) issues.push({ severity: 'error', code: 'script.animation', message: 'issue.script.animation', params: { node: n.name }, target: { nodeId: n.id, chapterId: n.chapterId } });
        if (a.type === 'variable' && v && !varIds.has(String(v)) && !local?.has(String(v))) issues.push({ severity: 'error', code: 'var.missing', message: 'issue.var.missing', params: { node: n.name }, target: { nodeId: n.id, chapterId: n.chapterId } });
        if (isExpr(v)) checkVars(v, varIds, n, issues, local);
      }
      walk(b.body);
      walk(b.else);
    }
  };
  walk(blocks);
}

function checkScene(engine: Engine, project: Project, n: StoryNode, varIds: Set<string>, assetIds: Set<string>, issues: Issue[], missingType: (t: string, k: string, nodeId?: string, chapterId?: string) => void, env: ValidationEnv) {
  const d = n.data as SceneData;
  const target = { nodeId: n.id, chapterId: n.chapterId };
  const local = new Set((d.localVariables || []).map((v) => v.id));
  const layerIds = new Set(d.layers.map((l) => l.id));
  for (const l of d.layers) {
    if (!engine.layerTypes.has(l.type)) missingType(l.type, 'layer', n.id, n.chapterId);
    if (l.parentId && !layerIds.has(l.parentId)) issues.push({ severity: 'warning', code: 'layer.parent', message: 'issue.layer.parent', params: { layer: l.name, node: n.name }, target: { ...target, layerId: l.id } });
    checkLayerAssets(l, assetIds, n, issues, env);
    if (l.effect?.kind === 'inline') for (const en of l.effect.graph.nodes) if (!engine.effectNodes.has(en.type)) missingType(en.type, 'effect', n.id, n.chapterId);
    if (l.effect?.kind === 'ref' && !project.effectGraphs.some((g) => g.id === (l.effect as any).graphId)) {
      issues.push({ severity: 'error', code: 'effect.ref', message: 'issue.effect.ref', params: { layer: l.name }, target: { ...target, layerId: l.id } });
    }
  }
  for (const a of d.animations) {
    for (const t of a.tracks) {
      const layer = d.layers.find((l) => l.id === t.layerId);
      if (!layer) { issues.push({ severity: 'error', code: 'anim.layer', message: 'issue.anim.layer', params: { anim: a.name, node: n.name }, target }); continue; }
      const props = engine.layerProps(layer.type);
      if (engine.layerTypes.has(layer.type) && !props.some((p) => p.key === t.prop) && !t.prop.startsWith('fx.')) {
        issues.push({ severity: 'warning', code: 'anim.prop', message: 'issue.anim.prop', params: { anim: a.name, prop: t.prop }, target: { ...target, layerId: layer.id } });
      }
      for (const k of t.keyframes) if (!engine.interpolators.has(k.ease)) missingType(k.ease, 'interpolator', n.id, n.chapterId);
    }
    for (const m of a.media) if (!layerIds.has(m.layerId)) issues.push({ severity: 'error', code: 'anim.media', message: 'issue.anim.layer', params: { anim: a.name, node: n.name }, target });
  }
  for (const c of d.choices) {
    checkVars(c.condition, varIds, n, issues, local);
    for (const e of c.effects) if (!varIds.has(e.varId) && !local.has(e.varId)) issues.push({ severity: 'error', code: 'var.missing', message: 'issue.var.missing', params: { node: n.name }, target });
    if (!c.text.trim()) issues.push({ severity: 'warning', code: 'choice.empty', message: 'issue.choice.empty', params: { node: n.name }, target });
  }
  for (const line of d.dialogue) {
    if (line.speakerId && !project.characters.some((c) => c.id === line.speakerId)) issues.push({ severity: 'warning', code: 'line.speaker', message: 'issue.line.speaker', params: { node: n.name }, target });
    if (line.voiceAssetId && !assetIds.has(line.voiceAssetId)) issues.push({ severity: 'error', code: 'asset.missingRef', message: 'issue.asset.missingRef', params: { node: n.name }, target });
  }
  for (const s of d.scripts) {
    checkBlocks(engine, [s.hat], n, d, varIds, issues, missingType, local);
    checkBlocks(engine, s.body, n, d, varIds, issues, missingType, local);
  }
  if (d.transition?.type && !engine.transitions.has(d.transition.type)) missingType(d.transition.type, 'transition', n.id, n.chapterId);
}

function checkLayerAssets(l: Layer, assetIds: Set<string>, n: StoryNode, issues: Issue[], env: ValidationEnv) {
  for (const [k, v] of Object.entries(l.props || {})) {
    if (typeof v !== 'string' || !/assetid$/i.test(k)) continue;
    if (v && !assetIds.has(v)) issues.push({ severity: 'error', code: 'asset.missingRef', message: 'issue.asset.layer', params: { layer: l.name, node: n.name }, target: { nodeId: n.id, chapterId: n.chapterId, layerId: l.id } });
    else if (v && env.missingAssets?.has(v)) issues.push({ severity: 'error', code: 'asset.missingFileUsed', message: 'issue.asset.layerFile', params: { layer: l.name, node: n.name }, target: { nodeId: n.id, chapterId: n.chapterId, layerId: l.id, assetId: v } });
  }
}
