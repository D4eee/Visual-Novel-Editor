/**
 * Editor tools for the AI assistant.
 *
 * Each tool is described the way the Model Context Protocol (MCP) describes tools — a `name`,
 * a `description` and a JSON Schema `inputSchema` — and runs against the open project through
 * the same undoable updates as the editor's own buttons. Every change is one undo step labelled
 * "AI · …", so the user can step back through what the assistant did.
 */
import type { Block, Layer, Project, SceneData, StoryNode, VariableDef } from '@vne/core';
import {
  newId, createNode, createChapter, createLayer, createDialogueLine, createAnimation, nodePorts, connect, deleteNodes, hasSceneData,
  DIALOGUE_LAYER, CHOICE_LAYER, CHOICE_STYLE, choiceLayers, sceneLines, nextSceneNumber, syncSceneChoiceEdges, startNode,
} from '@vne/core';
import { normalizeTrack } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { newBlock } from '../script/BlockEditor';
import { ANIM_PRESETS, STYLE_PRESETS, applyAnimPreset, applyStyle } from '../scene/ElementTabs';
import { EFFECT_PRESETS } from '../effects/presets';
import { setParent, unlinkDeleted } from '../scene/sceneOps';
import { applyScript } from '../story/ImportScript';
import { sceneImage } from './snapshot';
import { addGeneratedImage, errorText, generateImages, useAsBackground } from '../assets/ImageGen';
import { parseScript } from '@vne/core';

/** An MCP tool definition. */
export interface McpTool { name: string; description: string; inputSchema: Record<string, any>; readOnly?: boolean }

export interface ToolResult { text: string; isError?: boolean; images?: { mediaType: string; data: string }[] }

/** A tool answer with pictures (for vision models). */
class WithImages { constructor(readonly value: string | object, readonly images: { mediaType: string; data: string }[]) {} }

type Run = (session: ProjectSession, input: any, label: (s: string) => string) => string | object | Promise<string | object>;

const S = {
  str: (description: string) => ({ type: 'string', description }),
  num: (description: string) => ({ type: 'number', description }),
  bool: (description: string) => ({ type: 'boolean', description }),
  obj: (properties: Record<string, any>, required: string[] = [], description?: string) => ({ type: 'object', properties, required, ...(description ? { description } : {}), additionalProperties: false }),
  arr: (items: any, description: string) => ({ type: 'array', items, description }),
  any: (description: string) => ({ description }),
};

class ToolError extends Error {}
const fail = (msg: string): never => { throw new ToolError(msg); };

/* ------------------------------------------------------------------ */
/* Lookups                                                              */
/* ------------------------------------------------------------------ */

function nodeOf(p: Project, id: string): StoryNode {
  const n = p.nodes[id] || Object.values(p.nodes).find((x) => x.name.toLowerCase() === String(id || '').toLowerCase());
  return n || fail(`No node "${id}". Use get_project_overview to see node ids.`);
}
function sceneNode(p: Project, id: string): StoryNode<SceneData> {
  const n = nodeOf(p, id);
  return hasSceneData(n) ? (n as StoryNode<SceneData>) : fail(`Node "${n.name}" (${n.type}) is not a scene.`);
}
function layerOf(scene: SceneData, id: string): Layer {
  const l = scene.layers.find((x) => x.id === id) || scene.layers.find((x) => x.name.toLowerCase() === String(id || '').toLowerCase());
  return l || fail(`No element "${id}" in this scene. Use get_scene to see element ids.`);
}
function characterId(p: Project, who: any): string | null {
  if (who == null || who === '' || /^(narrator|旁白|none|null)$/i.test(String(who))) return null;
  const c = p.characters.find((x) => x.id === who) || p.characters.find((x) => x.name.toLowerCase() === String(who).toLowerCase());
  return c ? c.id : fail(`No character "${who}". Add it with add_character first.`);
}
const round = (v: any) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const short = (v: any, n = 80) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };

function chapterOf(p: Project, id?: string, fallback?: string) {
  if (!id) return p.chapters.find((c) => c.id === fallback) || p.chapters[0];
  return p.chapters.find((c) => c.id === id) || p.chapters.find((c) => c.name.toLowerCase() === id.toLowerCase()) || fail(`No chapter "${id}".`);
}

/** The scene's dialogue element, created when missing (inside a draft). */
function ensureDialogue(session: ProjectSession, draft: Project, scene: SceneData): Layer {
  let l = scene.layers.find((x) => x.type === DIALOGUE_LAYER);
  if (!l) {
    l = createLayer(session.engine, draft, DIALOGUE_LAYER, session.i18n.t('layer.dialogue'));
    l.props.lines = [];
    scene.layers.push(l);
  }
  if (!Array.isArray(l.props.lines)) l.props.lines = [];
  return l;
}

/** Validate a property patch against the element type; returns the clean patch. */
function cleanProps(session: ProjectSession, type: string, props: Record<string, any>): Record<string, any> {
  const defs = session.engine.layerProps(type);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(props || {})) {
    const d = defs.find((x) => x.key === k);
    if (!d && !k.startsWith('fx.') && !k.startsWith('param.')) fail(`Element type ${type} has no property "${k}". Properties: ${defs.map((x) => x.key).join(', ')}`);
    out[k] = d?.type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return out;
}

/** Turn {type, args, body, else} JSON into blocks (defaults filled in). */
function buildBlocks(session: ProjectSession, list: any[]): Block[] {
  return (list || []).map((x: any) => {
    const def = session.engine.blocks.get(x?.type) || fail(`Unknown block "${x?.type}". Use list_blocks to see block ids.`);
    if (def.shape === 'hat') fail(`"${def.id}" is a trigger; put it in "trigger", not in the blocks list.`);
    const b = newBlock(def);
    for (const [k, v] of Object.entries(x.args || {})) {
      const a = def.args.find((y) => y.id === k) || fail(`Block ${def.id} has no argument "${k}". Arguments: ${def.args.map((y) => `${y.id}:${y.type}`).join(', ') || 'none'}`);
      b.args[a.id] = (a.type === 'expr' && (typeof v !== 'object' || v === null) ? { k: 'lit', v } : v) as any;
    }
    if (x.body) b.body = buildBlocks(session, x.body);
    if (x.else) b.else = buildBlocks(session, x.else);
    return b;
  });
}

/* ------------------------------------------------------------------ */
/* Tools                                                                */
/* ------------------------------------------------------------------ */

const TOOLS: (McpTool & { run: Run })[] = [
  {
    name: 'get_project_overview', readOnly: true,
    description: 'Read the open project: chapters, story nodes (scenes and logic) with their ids and connections, characters, variables, items, assets and what the user has open or selected. Call this first.',
    inputSchema: S.obj({}),
    run: (session) => {
      const p = session.project;
      const tab = session.ui.tabs[session.ui.active];
      return {
        name: p.name, resolution: p.settings.resolution, title: p.settings.title,
        start: startNode(p)?.id ?? null,
        chapters: p.chapters.map((c) => ({
          id: c.id, name: c.name,
          nodes: Object.values(p.nodes).filter((n) => n.chapterId === c.id).map((n) => ({
            id: n.id, type: n.type, name: n.name, ...(hasSceneData(n) ? { scene: (n.data as SceneData).number, lines: sceneLines(n.data as SceneData).length, choices: choiceLayers(n.data as SceneData).map((l) => l.props.text) } : {}),
            next: p.edges.filter((e) => e.from.node === n.id).map((e) => ({ port: e.from.port, to: e.to.node })),
          })),
        })),
        characters: p.characters.map((c) => ({ id: c.id, name: c.name, color: c.color })),
        variables: p.variables.map((v) => ({ id: v.id, name: v.name, type: v.type, initial: v.initial })),
        items: (p.items || []).map((i: any) => i.name),
        assets: p.assets.slice(0, 80).map((a: any) => ({ id: a.id, name: a.name, kind: a.kind })),
        open: tab?.kind === 'node' ? tab.nodeId : 'story graph',
        selectedNodes: session.ui.selection.nodes,
        selectedElements: tab?.kind === 'node' ? session.sceneUI(tab.nodeId).selectedLayers : [],
      };
    },
  },
  {
    name: 'get_scene', readOnly: true,
    description: 'Read one scene: its elements (id, type, name, main properties, parent link), dialogue lines, choices, animations with their keyframed properties, and interaction scripts.',
    inputSchema: S.obj({ node_id: S.str('Scene node id (or exact name)') }, ['node_id']),
    run: (session, i) => {
      const n = sceneNode(session.project, i.node_id);
      const s = n.data;
      return {
        id: n.id, name: n.name, number: s.number, background: s.background,
        elements: s.layers.map((l) => ({
          id: l.id, type: l.type, name: l.name, visible: l.visible, ...(l.parentId ? { group: l.parentId } : {}), ...(l.link ? { parent: l.link } : {}),
          props: Object.fromEntries(Object.entries(l.props).filter(([k]) => k !== 'lines').map(([k, v]) => [k, typeof v === 'object' ? short(v, 60) : round(v)])),
          ...(l.effect ? { effect: true } : {}),
        })),
        dialogue: sceneLines(s).map((d) => ({ id: d.id, speaker: session.project.characters.find((c) => c.id === d.speakerId)?.name || 'narrator', text: d.text })),
        choices: choiceLayers(s).map((l) => ({ element: l.id, text: l.props.text, to: session.project.edges.find((e) => e.from.node === n.id && e.from.port.endsWith(l.id))?.to.node ?? null })),
        animations: s.animations.map((a) => ({ id: a.id, name: a.name, duration: a.duration, autoplay: a.autoplay, loop: a.loop, tracks: a.tracks.map((tr) => ({ element: tr.layerId, prop: tr.prop, keys: tr.keyframes.map((k) => [round(k.t), round(k.v), k.ease]) })) })),
        scripts: s.scripts.map((st) => ({ id: st.id, trigger: st.hat?.type, blocks: st.body.length, enabled: st.enabled })),
      };
    },
  },
  {
    name: 'view_scene', readOnly: true,
    description: 'Look at a scene: returns a picture of its stage (what players see, with the text box sketched in). Use it to check layout, overlaps, colors and readability after changes. Needs a model that accepts images.',
    inputSchema: S.obj({ node_id: S.str('Scene (default: the scene open in the editor)'), time: S.num('Seconds into the scene\'s first animation (default 0)') }),
    run: async (session, i) => {
      const id = i.node_id ? sceneNode(session.project, i.node_id).id : session.currentNodeId;
      if (!id || !hasSceneData(session.project.nodes[id])) fail('No scene is open; pass node_id.');
      const img = await sceneImage(session, id!, { time: typeof i.time === 'number' ? i.time : 0 });
      return new WithImages({ node_id: id, name: session.project.nodes[id!].name, width: img.width, height: img.height, stage: session.project.settings.resolution }, [img]);
    },
  },
  {
    name: 'list_element_types', readOnly: true,
    description: 'Element (layer) types that can be added to scenes, or the full property list of one type (key, type, default, options) when "type" is given.',
    inputSchema: S.obj({ type: S.str('Optional element type id, e.g. core.text') }),
    run: (session, i) => {
      if (i.type) {
        const def = session.engine.layerTypes.get(i.type) || fail(`Unknown element type ${i.type}`);
        return { type: def.id, visual: def.visual !== false, props: session.engine.layerProps(def.id).map((p) => ({ key: p.key, type: p.type, default: p.default, ...(p.options ? { options: p.options.map((o: any) => o.value) } : {}), ...(p.animatable ? { animatable: true } : {}) })) };
      }
      return session.engine.layerTypes.list().map((d) => ({ type: d.id, label: session.i18n.t(d.label), visual: d.visual !== false }));
    },
  },
  {
    name: 'list_blocks', readOnly: true,
    description: 'Interaction blocks (Scratch-style) for add_script: id, category, shape (hat = trigger, statement, c = has a body, cap = ends the script, reporter/boolean = values) and arguments.',
    inputSchema: S.obj({ category: S.str('Optional category: events, control, looks, sound, sensing, variables, story, operators, game, elements') }),
    run: (session, i) => session.engine.blocks.list().filter((b) => !i.category || b.category === i.category).map((b) => ({ id: b.id, category: b.category, shape: b.shape, label: session.i18n.t(b.label), args: b.args.map((a) => `${a.id}:${a.type}`) })),
  },
  {
    name: 'create_scene',
    description: 'Add a scene to the story. Optionally connect it after another node (from that node\'s first free output, or the given port). Returns the new node id.',
    inputSchema: S.obj({
      name: S.str('Scene name'), chapter_id: S.str('Chapter id or name (default: the chapter shown)'), after_node_id: S.str('Connect this node to the new scene'),
      after_port: S.str('Output port of after_node_id (default: its first output)'), background: S.str('Background color, e.g. #1b1d2a'), x: S.num('Graph x'), y: S.num('Graph y'),
    }, ['name']),
    run: (session, i, label) => {
      let id = '';
      session.update(label(`create scene ${i.name}`), (d) => {
        const ch = chapterOf(d, i.chapter_id, session.ui.chapterId);
        const prev = i.after_node_id ? nodeOf(d, i.after_node_id) : null;
        const n = createNode(session.engine, d, 'core.scene', ch.id, Math.round(i.x ?? (prev ? prev.x + 320 : 120)), Math.round(i.y ?? (prev ? prev.y : 120)), i.name);
        (n.data as SceneData).number = nextSceneNumber(d);
        if (i.background) (n.data as SceneData).background = i.background;
        d.nodes[n.id] = n;
        id = n.id;
        if (prev) {
          const outs = nodePorts(session.engine, d, prev).outputs;
          const port = i.after_port ? outs.find((o) => o.id === i.after_port || o.label === i.after_port) : outs.find((o) => !d.edges.some((e) => e.from.node === prev.id && e.from.port === o.id)) || outs[0];
          const inp = nodePorts(session.engine, d, n).inputs[0];
          if (port && inp) connect(session.engine, d, { node: prev.id, port: port.id }, { node: n.id, port: inp.id });
        }
      });
      return { node_id: id };
    },
  },
  {
    name: 'connect_nodes',
    description: 'Connect an output of one story node to an input of another (choices are outputs of their scene, "c:<choice element id>").',
    inputSchema: S.obj({ from_node_id: S.str('From node'), to_node_id: S.str('To node'), from_port: S.str('Output port id (default: first output)'), to_port: S.str('Input port id (default: first input)') }, ['from_node_id', 'to_node_id']),
    run: (session, i, label) => {
      let edge: string | null = null;
      session.update(label('connect nodes'), (d) => {
        const a = nodeOf(d, i.from_node_id), b = nodeOf(d, i.to_node_id);
        const outs = nodePorts(session.engine, d, a).outputs, ins = nodePorts(session.engine, d, b).inputs;
        const op = i.from_port ? outs.find((o) => o.id === i.from_port || o.label === i.from_port) : outs[0];
        const ip = i.to_port ? ins.find((o) => o.id === i.to_port) : ins[0];
        if (!op || !ip) fail(`Ports not found. Outputs: ${outs.map((o) => o.id).join(', ')}; inputs: ${ins.map((o) => o.id).join(', ')}`);
        edge = connect(session.engine, d, { node: a.id, port: op!.id }, { node: b.id, port: ip!.id });
      });
      return edge ? { edge_id: edge } : fail('These ports cannot be connected.');
    },
  },
  {
    name: 'update_node',
    description: 'Rename or move a story node, or change a scene\'s background color.',
    inputSchema: S.obj({ node_id: S.str('Node'), name: S.str('New name'), x: S.num('Graph x'), y: S.num('Graph y'), background: S.str('Scene background color') }, ['node_id']),
    run: (session, i, label) => {
      session.update(label('edit node'), (d) => {
        const n = nodeOf(d, i.node_id);
        if (i.name) n.name = i.name;
        if (typeof i.x === 'number') n.x = i.x;
        if (typeof i.y === 'number') n.y = i.y;
        if (i.background && hasSceneData(n)) (n.data as SceneData).background = i.background;
      });
      return 'ok';
    },
  },
  {
    name: 'delete_nodes',
    description: 'Delete story nodes (and their connections). Use only when the user asked to remove them.',
    inputSchema: S.obj({ node_ids: S.arr({ type: 'string' }, 'Node ids') }, ['node_ids']),
    run: (session, i, label) => { session.update(label('delete nodes'), (d) => { deleteNodes(d, (i.node_ids || []).map((x: string) => nodeOf(d, x).id)); }); return 'ok'; },
  },
  {
    name: 'create_chapter',
    description: 'Add a chapter (a separate story graph page). Returns its id.',
    inputSchema: S.obj({ name: S.str('Chapter name') }, ['name']),
    run: (session, i, label) => { const c = createChapter(i.name); session.update(label(`add chapter ${i.name}`), (d) => { d.chapters.push(c); }); return { chapter_id: c.id }; },
  },
  {
    name: 'add_character',
    description: 'Add a character who can speak dialogue lines. Returns its id.',
    inputSchema: S.obj({ name: S.str('Name'), color: S.str('Name color, e.g. #f0a0c0'), description: S.str('Optional notes') }, ['name']),
    run: (session, i, label) => {
      const existing = session.project.characters.find((c) => c.name.toLowerCase() === String(i.name).toLowerCase());
      if (existing) return { character_id: existing.id, note: 'already existed' };
      const id = newId('chr');
      session.update(label(`add character ${i.name}`), (d) => { d.characters.push({ id, name: i.name, color: i.color || '#c9b8ff', portraits: [], ...(i.description ? { description: i.description } : {}) }); });
      return { character_id: id };
    },
  },
  {
    name: 'add_dialogue_lines',
    description: 'Add dialogue lines to a scene (creates its dialogue element if needed). speaker is a character name or id, or "narrator".',
    inputSchema: S.obj({
      node_id: S.str('Scene'),
      lines: S.arr(S.obj({ speaker: S.str('Character name/id or narrator'), text: S.str('Line text') }, ['text']), 'Lines in order'),
      after_line_id: S.str('Insert after this line (default: at the end)'),
    }, ['node_id', 'lines']),
    run: (session, i, label) => {
      const ids: string[] = [];
      session.update(label('add dialogue'), (d) => {
        const n = sceneNode(d, i.node_id);
        const l = ensureDialogue(session, d, n.data);
        const lines = l.props.lines as any[];
        let at = i.after_line_id ? lines.findIndex((x) => x.id === i.after_line_id) + 1 : lines.length;
        if (at <= 0 && i.after_line_id) at = lines.length;
        for (const x of i.lines || []) { const line = createDialogueLine(String(x.text ?? ''), characterId(d, x.speaker)); lines.splice(at++, 0, line); ids.push(line.id); }
      });
      return { line_ids: ids };
    },
  },
  {
    name: 'edit_dialogue_line',
    description: 'Change or delete one dialogue line.',
    inputSchema: S.obj({ node_id: S.str('Scene'), line_id: S.str('Line id'), text: S.str('New text'), speaker: S.str('New speaker'), delete: S.bool('Delete the line') }, ['node_id', 'line_id']),
    run: (session, i, label) => {
      session.update(label('edit dialogue'), (d) => {
        const n = sceneNode(d, i.node_id);
        const l = ensureDialogue(session, d, n.data);
        const lines = l.props.lines as any[];
        const k = lines.findIndex((x) => x.id === i.line_id);
        if (k < 0) fail(`No line ${i.line_id}`);
        if (i.delete) { lines.splice(k, 1); return; }
        if (typeof i.text === 'string') lines[k].text = i.text;
        if (i.speaker !== undefined) { lines[k].speakerId = characterId(d, i.speaker); lines[k].portraitId = null; }
      });
      return 'ok';
    },
  },
  {
    name: 'add_choice',
    description: 'Add a choice button to a scene; it becomes one of the scene\'s outputs. Optionally connect it to a target node.',
    inputSchema: S.obj({ node_id: S.str('Scene'), text: S.str('Choice text'), target_node_id: S.str('Node this choice leads to') }, ['node_id', 'text']),
    run: (session, i, label) => {
      let id = '';
      session.update(label(`add choice ${i.text}`), (d) => {
        const n = sceneNode(d, i.node_id);
        const s = n.data;
        const before = choiceLayers(s).map((l) => l.id);
        const { width: W, height: H } = d.settings.resolution;
        const k = before.length;
        const l = createLayer(session.engine, d, CHOICE_LAYER, String(i.text).slice(0, 40), { x: W / 2, y: Math.round(H * 0.3 + k * (CHOICE_STYLE.height + 16)), text: i.text });
        s.layers.push(l);
        id = l.id;
        syncSceneChoiceEdges(d, n.id, before);
        if (i.target_node_id) {
          const target = nodeOf(d, i.target_node_id);
          const port = nodePorts(session.engine, d, n).outputs.find((o) => o.id.endsWith(l.id));
          const inp = nodePorts(session.engine, d, target).inputs[0];
          if (port && inp) connect(session.engine, d, { node: n.id, port: port.id }, { node: target.id, port: inp.id });
        }
      });
      return { element_id: id };
    },
  },
  {
    name: 'import_script',
    description: 'Create scenes, dialogue and choices from a screenplay in one step (faster than many add_* calls for a whole story). Format, one item per line: "## Scene name" starts a scene; "# Chapter" starts a chapter; "Name: text" or "Name (portrait): text" is a line; other lines (or "> text") are narration; "* Choice text -> Scene name" adds a choice; "-> Scene name" or "-> END" says where the scene continues; "[bg: #hex or image asset name]", "[music: asset]", "[voice: asset]" (next line); "//" comments. Scenes without choices or "->" continue to the next scene. Missing characters are created.',
    inputSchema: S.obj({ script: S.str('The screenplay text'), chapter_id: S.str('Chapter for scenes outside a "#" chapter (default: the one shown)'), make_chapters: S.bool('Create chapters for "#" headings (default true)') }, ['script']),
    run: (session, i, label) => {
      const parsed = parseScript(String(i.script || ''));
      if (!parsed.chapters.some((c) => c.scenes.length)) fail('The script has no scenes.');
      const r = applyScript(session, parsed, { chapterId: i.chapter_id ? chapterOf(session.project, i.chapter_id).id : session.ui.chapterId, chapters: i.make_chapters !== false, label: label('import script') });
      return { node_ids: r.nodeIds, first_node_id: r.firstNodeId, characters_created: r.characters, warnings: r.warnings.map((w) => `line ${w.line}: ${w.code} ${w.text}`) };
    },
  },
  {
    name: 'generate_image',
    description: 'Draft an image with the image service set up in Settings → Image generation and add it to the assets. kind "background" makes a stage-sized scene background (set use_as_background_of to put it behind a scene); "character" makes a full-body sprite sketch (add portraits to a character in the Characters panel). Generating can cost money: only do it when the user asked for images. Returns the asset id.',
    inputSchema: S.obj({
      prompt: S.str('What to draw (subject, setting, style, light, mood)'),
      kind: { type: 'string', enum: ['background', 'character', 'other'], description: 'background (default), character or other' },
      name: S.str('Asset name (default: from the prompt)'),
      negative: S.str('Things to avoid'),
      use_as_background_of: S.str('Scene to use the image as background'),
    }, ['prompt']),
    run: async (session, i) => {
      const kind = ['background', 'character', 'other'].includes(i.kind) ? i.kind : 'background';
      const target = i.use_as_background_of ? sceneNode(session.project, i.use_as_background_of) : null;
      let r;
      try { r = await generateImages(session, { prompt: String(i.prompt), kind, negative: i.negative, count: 1 }); }
      catch (e) { return fail(`Image generation failed: ${errorText(session.i18n.t, e)}`); }
      const img = r.images[0];
      const asset = await addGeneratedImage(session, img, i.name || `${kind}-${i.prompt}`);
      if (!asset) return fail('The image could not be added to the assets.');
      if (target) useAsBackground(session, target.id, asset);
      return new WithImages({ asset_id: asset.id, name: asset.name, model: r.model, ...(target ? { background_of: target.id } : {}) }, [{ mediaType: img.mediaType, data: img.data }]);
    },
  },
  {
    name: 'add_element',
    description: 'Add an element (layer) to a scene: text, image, shape, button, character sprite, free dialogue box, audio… props uses the type\'s property keys (see list_element_types). Position x/y is the anchor point in stage pixels. Returns the element id.',
    inputSchema: S.obj({ node_id: S.str('Scene'), type: S.str('Element type, e.g. core.text, core.shape, core.image, core.freeDialogue'), name: S.str('Element name'), props: S.any('Property values, e.g. {"text":"Hello","x":640,"y":120,"fontSize":48}') }, ['node_id', 'type']),
    run: (session, i, label) => {
      const def = session.engine.layerTypes.get(i.type) || fail(`Unknown element type ${i.type}. Use list_element_types.`);
      if (i.type === CHOICE_LAYER) fail('Use add_choice for choices.');
      let id = '';
      session.update(label(`add ${i.name || session.i18n.t(def.label)}`), (d) => {
        const n = sceneNode(d, i.node_id);
        if (i.type === DIALOGUE_LAYER) { id = ensureDialogue(session, d, n.data).id; return; }
        const l = createLayer(session.engine, d, i.type, i.name || session.i18n.t(def.label), cleanProps(session, i.type, i.props || {}));
        if (i.type === 'core.background') n.data.layers.unshift(l); else n.data.layers.push(l);
        id = l.id;
      });
      return { element_id: id };
    },
  },
  {
    name: 'set_element_props',
    description: 'Change an element\'s properties (base values), visibility or name. To animate, use add_keyframes instead.',
    inputSchema: S.obj({ node_id: S.str('Scene'), element_id: S.str('Element id or name'), props: S.any('Property values to set'), name: S.str('New name'), visible: S.bool('Visible at the start of the scene') }, ['node_id', 'element_id']),
    run: (session, i, label) => {
      session.update(label('edit element'), (d) => {
        const n = sceneNode(d, i.node_id);
        const l = layerOf(n.data, i.element_id);
        Object.assign(l.props, cleanProps(session, l.type, i.props || {}));
        if (i.name) l.name = i.name;
        if (typeof i.visible === 'boolean') l.visible = i.visible;
      });
      return 'ok';
    },
  },
  {
    name: 'delete_elements',
    description: 'Remove elements from a scene (with their keyframes). Use only when the user asked.',
    inputSchema: S.obj({ node_id: S.str('Scene'), element_ids: S.arr({ type: 'string' }, 'Element ids') }, ['node_id', 'element_ids']),
    run: (session, i, label) => {
      session.update(label('delete elements'), (d) => {
        const n = sceneNode(d, i.node_id);
        const ids = new Set((i.element_ids || []).map((x: string) => layerOf(n.data, x).id));
        const before = choiceLayers(n.data).map((l) => l.id);
        const ui = session.sceneUI(n.id);
        unlinkDeleted(session, n.data, ids as Set<string>, ui.clipId, ui.time);
        n.data.layers = n.data.layers.filter((l) => !ids.has(l.id));
        for (const l of n.data.layers) { if (l.parentId && ids.has(l.parentId)) l.parentId = null; }
        for (const a of n.data.animations) { a.tracks = a.tracks.filter((t) => !ids.has(t.layerId)); a.media = a.media.filter((m) => !ids.has(m.layerId)); }
        syncSceneChoiceEdges(d, n.id, before);
      });
      return 'ok';
    },
  },
  {
    name: 'set_element_parent',
    description: 'Make an element follow another element\'s position, rotation and scale (After Effects-style parent). parent_id null removes the link. The element stays where it is.',
    inputSchema: S.obj({ node_id: S.str('Scene'), element_id: S.str('Child element'), parent_id: { type: ['string', 'null'], description: 'Parent element id, or null' } }, ['node_id', 'element_id', 'parent_id']),
    run: (session, i) => {
      const n = sceneNode(session.project, i.node_id);
      const child = layerOf(n.data, i.element_id);
      const parent = i.parent_id ? layerOf(n.data, i.parent_id) : null;
      setParent(session, n.id, child.id, parent ? parent.id : null);
      return 'ok';
    },
  },
  {
    name: 'add_keyframes',
    description: 'Animate a property of an element with keyframes (time in seconds from the animation start). Eases: linear, easeIn, easeOut, easeInOut, backOut, bounce, elastic, step. Creates the scene\'s animation if needed.',
    inputSchema: S.obj({
      node_id: S.str('Scene'), element_id: S.str('Element'), prop: S.str('Animatable property, e.g. x, y, opacity, scaleX, rotation'),
      keys: S.arr(S.obj({ time: S.num('Seconds'), value: S.any('Value'), ease: S.str('Ease to the next key') }, ['time', 'value']), 'Keyframes'),
      animation_id: S.str('Animation (default: the first one)'), replace: S.bool('Remove the property\'s other keys first'),
    }, ['node_id', 'element_id', 'prop', 'keys']),
    run: (session, i, label) => {
      session.update(label(`animate ${i.prop}`), (d) => {
        const n = sceneNode(d, i.node_id);
        const l = layerOf(n.data, i.element_id);
        const pdef = session.engine.layerProps(l.type).find((p) => p.key === i.prop);
        if (!pdef && !String(i.prop).startsWith('fx.')) fail(`${l.type} has no property ${i.prop}`);
        if (pdef && !pdef.animatable) fail(`${i.prop} cannot be animated`);
        let clip = i.animation_id ? n.data.animations.find((a) => a.id === i.animation_id) : n.data.animations[0];
        if (!clip) { clip = createAnimation(session.i18n.t('anim.defaultName', { n: 1 }), 2); clip.autoplay = true; n.data.animations.push(clip); }
        let tr = clip.tracks.find((x) => x.layerId === l.id && x.prop === i.prop);
        if (!tr) { tr = { id: newId('trk'), layerId: l.id, prop: i.prop, keyframes: [] }; clip.tracks.push(tr); }
        if (i.replace) tr.keyframes = [];
        for (const k of i.keys || []) {
          const time = Math.max(0, Number(k.time) || 0);
          const v = pdef?.type === 'number' ? Number(k.value) : k.value;
          const ex = tr.keyframes.find((x) => Math.abs(x.t - time) < 1e-3);
          if (ex) { ex.v = v; if (k.ease) ex.ease = k.ease; } else tr.keyframes.push({ id: newId('key'), t: time, v, ease: k.ease || 'easeInOut' });
          clip.duration = Math.max(clip.duration, Math.ceil(time * 10) / 10);
        }
        normalizeTrack(tr);
      });
      return 'ok';
    },
  },
  {
    name: 'apply_animation_preset',
    description: `Add a ready-made animation to an element at a time: ${ANIM_PRESETS.map((p) => p.id).join(', ')}.`,
    inputSchema: S.obj({ node_id: S.str('Scene'), element_id: S.str('Element'), preset: { type: 'string', enum: ANIM_PRESETS.map((p) => p.id) }, start: S.num('Start time in seconds (default 0)'), duration: S.num('Length in seconds (default 0.6)') }, ['node_id', 'element_id', 'preset']),
    run: (session, i, label) => {
      const n = sceneNode(session.project, i.node_id);
      const l = layerOf(n.data, i.element_id);
      const p = ANIM_PRESETS.find((x) => x.id === i.preset) || fail(`Unknown preset ${i.preset}`);
      applyAnimPreset(session, n.id, l.id, p, Math.max(0.05, Number(i.duration) || 0.6), label(`animation ${p.id}`), Math.max(0, Number(i.start) || 0));
      return 'ok';
    },
  },
  {
    name: 'apply_look',
    description: `Apply a built-in look to an element: text (${(STYLE_PRESETS['core.text'] || []).map((p) => p.id).join(', ')}), shape (${(STYLE_PRESETS['core.shape'] || []).map((p) => p.id).join(', ')}), button (${(STYLE_PRESETS['core.button'] || []).map((p) => p.id).join(', ')}), free dialogue (${(STYLE_PRESETS['core.freeDialogue'] || []).map((p) => p.id).join(', ')}); or a picture effect: ${EFFECT_PRESETS.filter((p) => p.id !== 'empty').map((p) => p.id).join(', ')}.`,
    inputSchema: S.obj({ node_id: S.str('Scene'), element_id: S.str('Element'), look: S.str('Look id'), effect: S.str('Effect id') }, ['node_id', 'element_id']),
    run: (session, i, label) => {
      const n = sceneNode(session.project, i.node_id);
      const l = layerOf(n.data, i.element_id);
      if (i.look) {
        const p = (STYLE_PRESETS[l.type] || []).find((x) => x.id === i.look) || fail(`No look "${i.look}" for ${l.type}`);
        applyStyle(session, n.id, l.id, p.props, label(`look ${p.id}`));
      }
      if (i.effect) {
        const e = EFFECT_PRESETS.find((x) => x.id === i.effect) || fail(`No effect "${i.effect}"`);
        session.update(label(`effect ${e.id}`), (d) => { const x = sceneNode(d, n.id).data.layers.find((y) => y.id === l.id); if (x) x.effect = { kind: 'inline', graph: e.make() }; });
      }
      return 'ok';
    },
  },
  {
    name: 'add_script',
    description: 'Add an interaction script to a scene: a trigger block and the blocks it runs, as JSON ({type, args, body?, else?}). Element arguments take element ids; expression arguments take a value. Check ids with list_blocks.',
    inputSchema: S.obj({
      node_id: S.str('Scene'),
      trigger: S.obj({ type: S.str('Hat block id, e.g. core.whenSceneStarts, core.whenLayerClicked'), args: S.any('Arguments') }, ['type']),
      blocks: S.arr(S.any('{ "type": "core.wait", "args": { "seconds": 1 } }'), 'Blocks in order'),
    }, ['node_id', 'trigger', 'blocks']),
    run: (session, i, label) => {
      const hatDef = session.engine.blocks.get(i.trigger?.type) || fail(`Unknown trigger ${i.trigger?.type}`);
      if (hatDef.shape !== 'hat') fail(`${hatDef.id} is not a trigger (hat) block`);
      const hat = newBlock(hatDef);
      Object.assign(hat.args, i.trigger.args || {});
      const body = buildBlocks(session, i.blocks || []);
      const id = newId('scr');
      session.update(label('add script'), (d) => { const n = sceneNode(d, i.node_id); n.data.scripts.push({ id, hat, body, enabled: true, x: 40 + (n.data.scripts.length % 3) * 360, y: 40 + Math.floor(n.data.scripts.length / 3) * 260 } as any); });
      return { script_id: id };
    },
  },
  {
    name: 'set_variable',
    description: 'Create or change a story variable (number, boolean or string).',
    inputSchema: S.obj({ name: S.str('Variable name'), type: { type: 'string', enum: ['number', 'boolean', 'string'] }, initial: S.any('Starting value'), description: S.str('Notes') }, ['name']),
    run: (session, i, label) => {
      let id = '';
      session.update(label(`variable ${i.name}`), (d) => {
        let v = d.variables.find((x) => x.name === i.name);
        const type = i.type || v?.type || (typeof i.initial === 'boolean' ? 'boolean' : typeof i.initial === 'string' ? 'string' : 'number');
        const initial = i.initial ?? (type === 'number' ? 0 : type === 'boolean' ? false : '');
        if (!v) { v = { id: newId('var'), name: i.name, type, initial, scope: 'game' } as VariableDef; d.variables.push(v); }
        else { v.type = type as any; v.initial = initial; }
        if (i.description) v.description = i.description;
        id = v.id;
      });
      return { variable_id: id };
    },
  },
  {
    name: 'set_project_settings',
    description: 'Change project settings: title, resolution, text speed (characters per second), auto-advance delay, text box colors and font size.',
    inputSchema: S.obj({
      title: S.str('Game title'), width: S.num('Stage width'), height: S.num('Stage height'), text_speed: S.num('Characters per second (0 = instant)'),
      auto_delay: S.num('Seconds'), textbox: S.obj({ background: S.str('Color'), textColor: S.str('Color'), nameColor: S.str('Color'), fontSize: S.num('px'), position: { type: 'string', enum: ['bottom', 'top', 'center'] } }),
    }),
    run: (session, i, label) => {
      session.update(label('project settings'), (d) => {
        const s = d.settings;
        if (i.title) s.title = i.title;
        if (i.width) s.resolution.width = Math.round(i.width);
        if (i.height) s.resolution.height = Math.round(i.height);
        if (typeof i.text_speed === 'number') s.textSpeed = i.text_speed;
        if (typeof i.auto_delay === 'number') s.autoAdvanceDelay = i.auto_delay;
        if (i.textbox) for (const [k, v] of Object.entries(i.textbox)) if (k in s.textbox) (s.textbox as any)[k] = v;
      });
      return 'ok';
    },
  },
  {
    name: 'open_in_editor', readOnly: true,
    description: 'Show a node to the user: opens a scene in the scene editor (optionally selecting an element), or the story graph.',
    inputSchema: S.obj({ node_id: S.str('Node to open (omit for the story graph)'), element_id: S.str('Element to select') }),
    run: (session, i) => {
      if (!i.node_id) { session.setUI({ active: 0 }); return 'ok'; }
      const n = nodeOf(session.project, i.node_id);
      session.openNode(n.id);
      if (i.element_id && hasSceneData(n)) session.setSceneUI(n.id, { selectedLayers: [layerOf(n.data as SceneData, i.element_id).id] });
      return 'ok';
    },
  },
];

/** The tools as MCP tool definitions (what the model sees). */
export function mcpTools(readOnly = false): McpTool[] {
  return TOOLS.filter((t) => !readOnly || t.readOnly).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export const TOOL_NAMES = TOOLS.map((t) => ({ name: t.name, readOnly: !!t.readOnly }));

/** Run one tool call; errors come back as text so the model can correct itself. */
export async function runTool(session: ProjectSession, name: string, input: any, labelPrefix: string, readOnly = false): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool ${name}`, isError: true };
  if (readOnly && !tool.readOnly) return { text: 'The user set the assistant to read-only: describe the change instead of making it.', isError: true };
  try {
    let out = await tool.run(session, input || {}, (s) => `${labelPrefix}${s}`);
    let images: ToolResult['images'];
    if (out instanceof WithImages) { images = out.images; out = out.value; }
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return { text: text.length > 60000 ? `${text.slice(0, 60000)}…(truncated)` : text, ...(images ? { images } : {}) };
  } catch (e: any) {
    return { text: e instanceof ToolError ? e.message : `Error: ${e?.message || e}`, isError: true };
  }
}
