/**
 * A scene's Script view: its dialogue and choices as plain text, in the same format as
 * "Import a script". Edits apply as you type (one undo step per pause); edits made elsewhere
 * (the dialogue list, the graph) show here when the text is not being edited.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, Project, SceneData } from '@vne/core';
import {
  CHOICE_LAYER, CHOICE_STYLE, DIALOGUE_LAYER, choiceLayers, choicePort, connect, createDialogueLine, createLayer, createNode, isEndTarget,
  newId, nodePorts, parseScript, sceneToScript, SCENE_DEFAULT_PORT, syncSceneChoiceEdges,
} from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/controls';

const COLORS = ['#f0a0c0', '#8fc3ff', '#ffd27a', '#9be3b0', '#c9b8ff', '#ffab85', '#7fe0e0', '#e6a8ff'];
const norm = (s: string) => s.trim().toLowerCase();

export interface ScriptNote { line: number; code: string; text: string }

/** What applying `text` to the scene would warn about (without changing anything). */
export function checkSceneScript(project: Project, nodeId: string, text: string): ScriptNote[] {
  const p = parseScript(text);
  const notes: ScriptNote[] = p.warnings.filter((w) => w.code !== 'choicesAndNext').map((w) => ({ ...w }));
  const scenes = p.chapters.flatMap((c) => c.scenes);
  if (scenes.length > 1 || p.chapters.some((c) => c.name)) notes.push({ line: scenes[1]?.line || 1, code: 'headings', text: '' });
  const chapterId = project.nodes[nodeId]?.chapterId;
  const target = (name: string, line: number) => {
    if (isEndTarget(name)) return;
    const n = Object.values(project.nodes).find((x) => norm(x.name) === norm(name));
    if (!n) notes.push({ line, code: 'noTarget', text: name });
    else if (n.chapterId !== chapterId) notes.push({ line, code: 'otherChapter', text: name });
  };
  for (const s of scenes) {
    for (const c of s.choices) if (c.target) target(c.target, c.line);
    if (s.next && s.next !== 'END') target(s.next, s.line);
    for (const l of s.lines) {
      if (l.portrait && l.speaker) {
        const ch = project.characters.find((c) => norm(c.name) === norm(l.speaker!));
        if (ch && !ch.portraits.some((pt) => norm(pt.name) === norm(l.portrait!))) notes.push({ line: l.line, code: 'noPortrait', text: `${ch.name} (${l.portrait})` });
      }
      if (l.voice && !project.assets.some((a) => a.kind === 'audio' && (norm(a.name) === norm(l.voice!) || norm(a.name).replace(/\.[a-z0-9]+$/, '') === norm(l.voice!)))) notes.push({ line: l.line, code: 'noAudio', text: l.voice });
    }
  }
  return notes;
}

/** Make the scene's dialogue and choices match the text (lines and choices keep their ids by position). */
export function applySceneScript(session: ProjectSession, nodeId: string, text: string, mergeKey?: string): void {
  const p = parseScript(text);
  const scenes = p.chapters.flatMap((c) => c.scenes);
  const lines = scenes.flatMap((s) => s.lines);
  const choices = scenes.flatMap((s) => s.choices);
  const next = choices.length ? undefined : scenes.length ? scenes[scenes.length - 1].next : undefined;
  const engine = session.engine;
  session.update(session.i18n.t('script.edit'), (d) => {
    const node = d.nodes[nodeId];
    if (!node) return;
    const s = node.data as SceneData;
    const { width: W, height: H } = d.settings.resolution;
    // Speakers that are not characters yet become characters.
    const charOf = (name: string) => {
      let c = d.characters.find((x) => norm(x.name) === norm(name));
      if (!c) { c = { id: newId('chr'), name, color: COLORS[d.characters.length % COLORS.length], portraits: [] }; d.characters.push(c); }
      return c;
    };
    const audio = (name: string) => d.assets.find((a) => a.kind === 'audio' && (norm(a.name) === norm(name) || norm(a.name).replace(/\.[a-z0-9]+$/, '') === norm(name)));
    // Dialogue
    let dl = s.layers.find((l) => l.type === DIALOGUE_LAYER);
    if (!dl && lines.length) { dl = createLayer(engine, d, DIALOGUE_LAYER, session.i18n.t('layer.dialogue')); s.layers.push(dl); }
    if (dl) {
      const old: any[] = Array.isArray(dl.props.lines) ? dl.props.lines : [];
      dl.props.lines = lines.map((pl, i) => {
        const line = old[i] ? { ...old[i] } : createDialogueLine('', null);
        line.text = pl.text.replace(/\\n/g, '\n');
        const ch = pl.speaker ? charOf(pl.speaker) : null;
        line.speakerId = ch?.id ?? null;
        delete line.speakerName;
        const pt = ch && pl.portrait ? ch.portraits.find((x) => norm(x.name) === norm(pl.portrait!)) : null;
        line.portraitId = pt ? pt.id : pl.portrait ? line.portraitId ?? null : null;
        line.voiceAssetId = pl.voice ? audio(pl.voice)?.id ?? line.voiceAssetId ?? null : null;
        return line;
      });
    }
    // Choices: by position (top to bottom on the stage).
    const before = choiceLayers(s).map((l) => l.id);
    const keep: Layer[] = [];
    choices.forEach((pc, i) => {
      let l = s.layers.find((x) => x.id === before[i]);
      if (!l) {
        const lastY = keep.length ? Number(keep[keep.length - 1].props.y) || 0 : Math.round(H * 0.3) - CHOICE_STYLE.height - 16;
        l = createLayer(engine, d, CHOICE_LAYER, pc.text.slice(0, 40), { x: W / 2, y: lastY + CHOICE_STYLE.height + 16, text: pc.text });
        s.layers.push(l);
      }
      const txt = pc.text.replace(/\\n/g, '\n');
      if (l.props.text !== txt) { l.props.text = txt; l.name = txt.slice(0, 40) || l.name; }
      keep.push(l);
    });
    const gone = new Set(before.filter((id) => !keep.some((l) => l.id === id)));
    s.layers = s.layers.filter((l) => !gone.has(l.id));
    syncSceneChoiceEdges(d, nodeId, before);
    // Connections named in the text; a choice or scene without "->" leads nowhere.
    const resolve = (name: string): string | null => {
      if (isEndTarget(name)) {
        const existing = d.edges.filter((e) => e.from.node === nodeId).map((e) => d.nodes[e.to.node]).find((n) => n?.type === 'core.ending');
        if (existing) return existing.id;
        const e = createNode(engine, d, 'core.ending', node.chapterId, node.x + 340, node.y, session.i18n.t('defaults.ending'));
        d.nodes[e.id] = e;
        return e.id;
      }
      const n = Object.values(d.nodes).find((x) => norm(x.name) === norm(name) && x.chapterId === node.chapterId);
      return n ? n.id : null;
    };
    const link = (port: string, target: string | null | undefined) => {
      const current = d.edges.find((e) => e.from.node === nodeId && e.from.port === port);
      if (target === undefined || target === null) { if (current) d.edges = d.edges.filter((e) => e !== current); return; }
      const to = resolve(target);
      if (!to) return; // unknown name: leave the connection as it is (the view lists the problem)
      if (current?.to.node === to) return;
      if (current) d.edges = d.edges.filter((e) => e !== current);
      const ip = nodePorts(engine, d, d.nodes[to]).inputs[0];
      if (ip) connect(engine, d, { node: nodeId, port }, { node: to, port: ip.id });
    };
    if (keep.length) keep.forEach((l, i) => link(choicePort(l.id), choices[i].target));
    else link(SCENE_DEFAULT_PORT, next === undefined ? null : next);
  }, mergeKey ? { mergeKey } : undefined);
}

export function ScriptView({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const serialized = sceneToScript(session.project, nodeId);
  const [draft, setDraft] = useState(serialized);
  const editing = useRef(false);
  const timer = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Changes made elsewhere show up when the text is not being edited.
  useEffect(() => { if (!editing.current) setDraft(serialized); }, [serialized]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const notes = useMemo(() => checkSceneScript(session.project, nodeId, draft), [draft, session.project, nodeId]);
  const apply = (text: string) => { if (text !== sceneToScript(session.project, nodeId)) applySceneScript(session, nodeId, text, `script-${nodeId}`); };
  const onChange = (v: string) => {
    editing.current = true;
    setDraft(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply(v), 700);
  };
  const onBlur = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    apply(draft);
    editing.current = false;
    setDraft(sceneToScript(session.project, nodeId));
  };
  const insert = (s: string) => {
    const el = area.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const lineStart = draft.lastIndexOf('\n', a - 1) + 1;
    const atStart = draft.slice(lineStart, a).trim() === '';
    const text = atStart ? s : `\n${s}`;
    const v = draft.slice(0, a) + text + draft.slice(b);
    onChange(v);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + text.length; });
  };
  const lineCount = draft.split('\n').length;
  return (
    <div className="script-view">
      <div className="script-edit">
        <div className="script-gutter" aria-hidden>{Array.from({ length: Math.max(lineCount, 1) }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
        <textarea ref={area} className="script-text" value={draft} spellCheck={false} placeholder={t('script.placeholder')}
          onChange={(e) => onChange(e.target.value)} onBlur={onBlur} onFocus={() => { editing.current = true; }}
          onScroll={(e) => { const g = (e.target as HTMLElement).previousElementSibling as HTMLElement; if (g) g.scrollTop = (e.target as HTMLElement).scrollTop; }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 's' && (e.metaKey || e.ctrlKey)) { onBlur(); } }} />
      </div>
      <aside className="script-side">
        <div className="script-sec">{t('script.title')}</div>
        <p className="muted small">{t('script.intro')}</p>
        <div className="script-sec">{t('script.characters')}</div>
        <div className="chip-wrap">
          {session.project.characters.map((c) => <button key={c.id} type="button" className="chip-btn" onClick={() => insert(`${c.name}: `)}><span className="dot" style={{ background: c.color }} />{c.name}</button>)}
          <button type="button" className="chip-btn" onClick={() => insert('> ')}>{t('script.narration')}</button>
          <button type="button" className="chip-btn" onClick={() => insert('* ')}>{t('script.choice')}</button>
        </div>
        <div className="script-sec">{t('script.format')}</div>
        <pre className="script-cheat">{t('script.cheat')}</pre>
        {notes.length > 0 && <div className="script-sec">{t('script.notes')}</div>}
        {notes.slice(0, 10).map((n, i) => (
          <div key={i} className={cx('import-note warn')}><Icon name="warning" size={13} /><span>{t('import.lineN', { n: n.line })}: {n.code === 'headings' ? t('script.w.headings') : t(`import.w.${n.code}`, { name: n.text })}</span></div>
        ))}
      </aside>
    </div>
  );
}
