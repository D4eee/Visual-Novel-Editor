/**
 * Script import: turn a plain-text screenplay (see core/scriptImport.ts) into scenes, dialogue
 * lines, choices and their connections. One undo step; scenes are laid out below what the
 * chapter already has.
 */
import { useMemo, useRef, useState } from 'react';
import type { Asset, Layer, Project, SceneData } from '@vne/core';
import {
  CHOICE_LAYER, CHOICE_STYLE, DIALOGUE_LAYER, connect, createChapter, createDialogueLine, createLayer, createNode, isEndTarget,
  newId, nextSceneNumber, nodePorts, parseScript, scriptStats, startNode, syncSceneChoiceEdges,
} from '@vne/core';
import type { ParsedScript } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store, useT } from '../state/store';
import { Modal } from '../ui/Modal';
import { Button, Toggle, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';

const COLORS = ['#f0a0c0', '#8fc3ff', '#ffd27a', '#9be3b0', '#c9b8ff', '#ffab85', '#7fe0e0', '#e6a8ff'];

export interface ImportResult { nodeIds: string[]; firstNodeId: string | null; characters: number; warnings: { line: number; code: string; text: string }[] }

const norm = (s: string) => s.trim().toLowerCase();
const assetNamed = (p: Project, kind: Asset['kind'], name: string) => {
  const k = norm(name);
  return p.assets.find((a) => a.kind === kind && (norm(a.name) === k || norm(a.name).replace(/\.[a-z0-9]+$/, '') === k));
};

/** Apply a parsed script to the project (one history step). */
export function applyScript(session: ProjectSession, parsed: ParsedScript, opts: { chapterId?: string; chapters?: boolean; label?: string } = {}): ImportResult {
  const res: ImportResult = { nodeIds: [], firstNodeId: null, characters: 0, warnings: [...parsed.warnings] };
  const engine = session.engine;
  session.update(opts.label || session.i18n.t('import.history'), (d) => {
    const { width: W, height: H } = d.settings.resolution;
    // Speakers → characters (existing ones are matched by name).
    const charOf = new Map<string, string>();
    for (const name of parsed.speakers) {
      const c = d.characters.find((x) => norm(x.name) === norm(name));
      if (c) { charOf.set(name, c.id); continue; }
      const id = newId('chr');
      d.characters.push({ id, name, color: COLORS[(d.characters.length) % COLORS.length], portraits: [] });
      charOf.set(name, id);
      res.characters++;
    }
    const baseChapter = d.chapters.find((c) => c.id === opts.chapterId) || d.chapters[0];
    type Made = { id: string; chapterId: string; scene: ParsedScript['chapters'][number]['scenes'][number] };
    const made: Made[] = [];
    const byName = new Map<string, Made>();
    const endings = new Map<string, string>();

    for (const pc of parsed.chapters) {
      let chapterId = baseChapter.id;
      let created = false;
      if (pc.name && opts.chapters !== false) { const c = createChapter(pc.name); d.chapters.push(c); chapterId = c.id; created = true; }
      const existing = Object.values(d.nodes).filter((n) => n.chapterId === chapterId);
      const y0 = existing.length ? Math.max(...existing.map((n) => n.y)) + 220 : 120;
      const x0 = existing.length ? Math.min(...existing.map((n) => n.x)) : 120;
      pc.scenes.forEach((ps, i) => {
        const name = ps.name || `${session.i18n.t('node.scene')} ${nextSceneNumber(d)}`;
        const n = createNode(engine, d, 'core.scene', chapterId, x0 + (i % 5) * 320, y0 + Math.floor(i / 5) * 260, name);
        const s = n.data as SceneData;
        s.number = nextSceneNumber(d);
        d.nodes[n.id] = n;
        if (ps.background) {
          if (/^(#|rgb|hsl)/i.test(ps.background)) s.background = ps.background;
          else {
            const a = assetNamed(d, 'image', ps.background);
            if (a) { const l = createLayer(engine, d, 'core.background', a.name, { assetId: a.id }); s.layers.unshift(l); }
            else res.warnings.push({ line: ps.line, code: 'noImage', text: ps.background });
          }
        }
        if (ps.music) {
          const a = assetNamed(d, 'audio', ps.music);
          if (a) s.layers.push(createLayer(engine, d, 'core.audio', a.name, { assetId: a.id }));
          else res.warnings.push({ line: ps.line, code: 'noAudio', text: ps.music });
        }
        if (ps.lines.length) {
          const dl: Layer = createLayer(engine, d, DIALOGUE_LAYER, session.i18n.t('layer.dialogue'));
          dl.props.lines = ps.lines.map((pl) => {
            const line = createDialogueLine(pl.text, pl.speaker ? charOf.get(pl.speaker) ?? null : null);
            if (pl.portrait && line.speakerId) {
              const ch = d.characters.find((c) => c.id === line.speakerId)!;
              const pt = ch.portraits.find((x) => norm(x.name) === norm(pl.portrait!));
              if (pt) line.portraitId = pt.id; else res.warnings.push({ line: pl.line, code: 'noPortrait', text: `${ch.name} (${pl.portrait})` });
            }
            if (pl.voice) { const a = assetNamed(d, 'audio', pl.voice); if (a) line.voiceAssetId = a.id; else res.warnings.push({ line: pl.line, code: 'noAudio', text: pl.voice }); }
            return line;
          });
          s.layers.push(dl);
        }
        ps.choices.forEach((pch, k) => {
          s.layers.push(createLayer(engine, d, CHOICE_LAYER, pch.text.slice(0, 40), { x: W / 2, y: Math.round(H * 0.3 + k * (CHOICE_STYLE.height + 16)), text: pch.text }));
        });
        if (ps.choices.length) syncSceneChoiceEdges(d, n.id, []);
        const m = { id: n.id, chapterId, scene: ps };
        made.push(m);
        if (ps.name) { if (byName.has(norm(ps.name))) res.warnings.push({ line: ps.line, code: 'duplicate', text: ps.name }); else byName.set(norm(ps.name), m); }
        res.nodeIds.push(n.id);
      });
      // A new chapter starts at its first scene (existing chapters keep their entry).
      const first = made.find((m) => m.chapterId === chapterId);
      if (created && first) d.chapters.find((c) => c.id === chapterId)!.entryNodeId = first.id;
    }

    const link = (fromId: string, port: string | undefined, toId: string) => {
      const outs = nodePorts(engine, d, d.nodes[fromId]).outputs;
      const op = port ? outs.find((o) => o.id === port) : outs[0];
      const ip = nodePorts(engine, d, d.nodes[toId]).inputs[0];
      if (op && ip) connect(engine, d, { node: fromId, port: op.id }, { node: toId, port: ip.id });
    };
    const ending = (chapterId: string, near: string) => {
      if (endings.has(chapterId)) return endings.get(chapterId)!;
      const ref = d.nodes[near];
      const e = createNode(engine, d, 'core.ending', chapterId, ref.x + 320, ref.y, session.i18n.t('node.ending'));
      d.nodes[e.id] = e;
      endings.set(chapterId, e.id);
      res.nodeIds.push(e.id);
      return e.id;
    };
    const resolve = (m: Made, target: string, line: number): string | null => {
      if (isEndTarget(target)) return ending(m.chapterId, m.id);
      const hit = byName.get(norm(target))?.id || Object.values(d.nodes).find((n) => !res.nodeIds.includes(n.id) && norm(n.name) === norm(target))?.id;
      if (!hit) { res.warnings.push({ line, code: 'noTarget', text: target }); return null; }
      if (d.nodes[hit].chapterId !== m.chapterId) { res.warnings.push({ line, code: 'otherChapter', text: target }); return null; }
      return hit;
    };
    made.forEach((m, i) => {
      const ps = m.scene;
      if (ps.choices.length) {
        const choiceIds = d.nodes[m.id].data.layers.filter((l: Layer) => l.type === CHOICE_LAYER).map((l: Layer) => l.id);
        ps.choices.forEach((pch, k) => {
          if (!pch.target) return;
          const to = resolve(m, pch.target, pch.line);
          if (to) link(m.id, nodePorts(engine, d, d.nodes[m.id]).outputs.find((o) => o.id.endsWith(choiceIds[k]))?.id, to);
        });
      } else if (ps.next === 'END') link(m.id, undefined, ending(m.chapterId, m.id));
      else if (ps.next) { const to = resolve(m, ps.next, ps.line); if (to) link(m.id, undefined, to); }
      else if (ps.next === undefined) { const nx = made[i + 1]; if (nx && nx.chapterId === m.chapterId) link(m.id, undefined, nx.id); }
    });

    // A start node with nothing after it leads to the first imported scene.
    const start = startNode(d);
    const first = made[0];
    if (start && first && start.chapterId === first.chapterId && !d.edges.some((e) => e.from.node === start.id)) link(start.id, undefined, first.id);
    res.firstNodeId = first?.id ?? null;
  });
  return res;
}

const SAMPLE_EN = `## Morning
[bg: #2a3350]
The alarm rang for the third time.
Mia: Five more minutes…
Mom (angry): You'll be late again!
* Get up -> Kitchen
* Stay in bed -> Late

## Kitchen
Mom: Breakfast is ready.
-> END

## Late
> Note: she was late. Very late.
-> END`;
const SAMPLE_ZH = `## 清晨
[bg: #2a3350]
闹钟第三次响了。
小美：再睡五分钟……
妈妈（生气）：你又要迟到了！
* 起床 -> 厨房
* 继续睡 -> 迟到

## 厨房
妈妈：早饭好了。
-> 结束

## 迟到
> 结果：她迟到了，迟到得很厉害。
-> 结束`;

export function ImportScriptDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  const t = useT();
  const zh = session.i18n.locale === 'zh-CN';
  const [text, setText] = useState('');
  const [chapters, setChapters] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseScript(text), [text]);
  const st = scriptStats(parsed);
  const known = new Set<string>();
  for (const c of parsed.chapters) for (const s of c.scenes) if (s.name) known.add(norm(s.name));
  const missing: { line: number; target: string }[] = [];
  for (const c of parsed.chapters) for (const s of c.scenes) {
    for (const ch of s.choices) if (ch.target && !isEndTarget(ch.target) && !known.has(norm(ch.target)) && !Object.values(session.project.nodes).some((n) => norm(n.name) === norm(ch.target!))) missing.push({ line: ch.line, target: ch.target });
    if (s.next && s.next !== 'END' && !known.has(norm(s.next)) && !Object.values(session.project.nodes).some((n) => norm(n.name) === norm(s.next!))) missing.push({ line: s.line, target: s.next });
  }
  const newSpeakers = parsed.speakers.filter((n) => !session.project.characters.some((c) => norm(c.name) === norm(n)));
  const run = () => {
    const r = applyScript(session, parsed, { chapterId: session.ui.chapterId, chapters });
    onClose();
    if (r.firstNodeId) session.setUI({ graphFocus: { nodeId: r.firstNodeId, key: Date.now() } });
    const extra = r.warnings.length;
    store.toast(t('import.done', { scenes: st.scenes, lines: st.lines, choices: st.choices }) + (extra ? ` · ${t('import.warnings', { n: extra })}` : ''), extra ? 'info' : 'success');
  };
  return (
    <Modal title={t('import.title')} onClose={onClose} width={980} icon={<Icon name="fileText" size={18} />} className="import-modal"
      footer={<>
        <Toggle value={chapters} onChange={setChapters} label={t('import.makeChapters')} />
        <span className="grow" />
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button kind="primary" icon="fileText" disabled={!st.scenes || !st.lines && !st.choices} onClick={run}>{t('import.run', { n: st.scenes })}</Button>
      </>}>
      <div className="import-grid">
        <div className="import-edit">
          <div className="import-bar">
            <span className="muted small">{t('import.hint')}</span>
            <span className="grow" />
            <Button small kind="ghost" onClick={() => setText(zh ? SAMPLE_ZH : SAMPLE_EN)}>{t('import.sample')}</Button>
            <Button small icon="upload" onClick={() => fileRef.current?.click()}>{t('import.openFile')}</Button>
            <input ref={fileRef} type="file" accept=".txt,.md,.fountain,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }} />
          </div>
          <textarea className="input import-text" value={text} spellCheck={false} placeholder={zh ? SAMPLE_ZH : SAMPLE_EN} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="import-side">
          <div className="import-stats">
            {(['scenes', 'lines', 'choices', 'speakers'] as const).map((k) => <div key={k}><b>{st[k]}</b><span>{t(`import.stat.${k}`)}</span></div>)}
          </div>
          {newSpeakers.length > 0 && <div className="import-note"><Icon name="user" size={13} />{t('import.newCharacters', { names: newSpeakers.join(', ') })}</div>}
          {[...missing.map((m) => ({ line: m.line, text: t('import.w.noTarget', { name: m.target }) })), ...parsed.warnings.map((w) => ({ line: w.line, text: t(`import.w.${w.code}`, { name: w.text }) }))].slice(0, 12).map((w, i) => (
            <div key={i} className="import-note warn"><Icon name="warning" size={13} /><span>{t('import.lineN', { n: w.line })}: {w.text}</span></div>
          ))}
          <div className="import-outline">
            {parsed.chapters.map((c, ci) => (
              <div key={ci}>
                {c.name && <div className="import-ch"><Icon name="book" size={12} />{c.name}</div>}
                {c.scenes.map((s, si) => (
                  <div key={si} className={cx('import-scene', !s.name && 'unnamed')}>
                    <div className="import-sc-name"><Icon name="scene" size={12} />{s.name || t('import.unnamed')}<span className="muted"> · {t('import.nLines', { n: s.lines.length })}</span></div>
                    {s.choices.map((ch, k) => <div key={k} className="import-arrow"><Icon name="choice" size={11} />{ch.text}{ch.target && <span className="muted"> → {isEndTarget(ch.target) ? t('node.ending') : ch.target}</span>}</div>)}
                    {!s.choices.length && s.next && <div className="import-arrow"><Icon name="arrowRight" size={11} />{s.next === 'END' ? t('node.ending') : s.next}</div>}
                  </div>
                ))}
              </div>
            ))}
            {!st.scenes && <div className="muted small">{t('import.empty')}</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
