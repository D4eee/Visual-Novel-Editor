import type { SceneData } from '@vne/core';
import { chapterEntry, nodesInChapter, deleteNodes } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { Field, TextInput, Select, Button, Section, Empty, IconButton } from '../ui/controls';
import { NodeForm } from '../logic/NodeForms';
import { ChoicesEditor } from '../scene/choices';
import { Icon } from '../ui/Icon';
import { nodeTypeLabel } from './nodeModel';
import { IssueList } from '../problems/Problems';
import { stripMarkup } from '@vne/runtime';

export function StoryInspector({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const project = session.project;
  const sel = session.ui.selection.nodes.filter((id) => project.nodes[id]);
  const chapter = project.chapters.find((c) => c.id === session.ui.chapterId) || project.chapters[0];

  if (sel.length > 1) {
    return (
      <div className="inspector-body">
        <div className="insp-title"><Icon name="layers" size={16} /> {t('inspector.nNodes', { n: sel.length })}</div>
        <Field label={t('graph.moveToChapter')}>
          <Select value={null} placeholder={t('common.choose')} options={project.chapters.map((c) => ({ value: c.id, label: c.name }))} onChange={(cid) => session.update(t('graph.moveToChapter'), (d) => { for (const id of sel) d.nodes[id].chapterId = cid; })} />
        </Field>
        <Button kind="danger" icon="trash" onClick={() => { session.update(t('graph.deleteNodes', { n: sel.length }), (d) => deleteNodes(d, sel)); session.setUI({ selection: { nodes: [], edges: [] } }); }}>{t('common.delete')}</Button>
      </div>
    );
  }

  if (sel.length === 1) {
    const node = project.nodes[sel[0]];
    const def = session.engine.nodeTypes.get(node.type);
    const issues = session.issues.filter((i) => i.target?.nodeId === node.id);
    return (
      <div className="inspector-body">
        <div className="insp-title" style={{ ['--node-color' as any]: def?.color }}>
          <span className="type-chip"><Icon name={def?.icon || 'module'} size={14} />{nodeTypeLabel(session.engine, node.type, t)}</span>
        </div>
        <Field label={t('common.name')}>
          <TextInput value={node.name} onChange={(v) => session.update(t('common.rename'), (d) => { d.nodes[node.id].name = v; })} />
        </Field>
        <Field label={t('chapter.label')}>
          <Select value={node.chapterId} options={project.chapters.map((c) => ({ value: c.id, label: c.name }))} onChange={(cid) => session.update(t('graph.moveToChapter'), (d) => { d.nodes[node.id].chapterId = cid; })} />
        </Field>
        <NodeForm session={session} node={node} />
        {node.type === 'core.scene' && (
          <>
            <Section id="insp.scene.text" title={t('scene.dialogue')}>
              {(node.data as SceneData).dialogue.slice(0, 3).map((l) => (
                <div key={l.id} className="line-preview"><b>{project.characters.find((c) => c.id === l.speakerId)?.name || l.speakerName || t('dialogue.narrator')}</b> {stripMarkup(l.text).slice(0, 80)}</div>
              ))}
              {(node.data as SceneData).dialogue.length > 3 && <div className="muted small">{t('inspector.moreLines', { n: (node.data as SceneData).dialogue.length - 3 })}</div>}
              {!(node.data as SceneData).dialogue.length && <div className="muted small">{t('dialogue.none')}</div>}
            </Section>
            <Section id="insp.scene.choices" title={t('scene.choices')}>
              <ChoicesEditor session={session} nodeId={node.id} compact />
            </Section>
          </>
        )}
        <div className="insp-actions">
          {(def?.workspace || node.type === 'core.scene') && <Button kind="primary" icon={node.type === 'core.scene' ? 'scene' : 'arrowRight'} onClick={() => session.openNode(node.id)}>{node.type === 'core.scene' ? t('graph.openScene') : t('graph.openNode')}</Button>}
          <Button icon="play" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId: node.id, key: Date.now() } })}>{t('preview.fromHere')}</Button>
          <Button icon="module" kind="ghost" onClick={() => session.openNode(node.id, 'modules')}>{node.modules.length ? t('modules.attached', { n: node.modules.length }) : t('modules.addToNode')}</Button>
        </div>
        {issues.length > 0 && <Section id="insp.issues" title={t('problems.title')}><IssueList session={session} issues={issues} /></Section>}
      </div>
    );
  }

  // Nothing selected: chapter overview
  const nodes = nodesInChapter(project, chapter.id);
  const entry = chapterEntry(project, chapter.id);
  const scenes = nodes.filter((n) => n.type === 'core.scene');
  const issues = session.issues.filter((i) => i.target?.chapterId === chapter.id);
  return (
    <div className="inspector-body">
      <div className="insp-title"><Icon name="book" size={16} /> {t('chapter.label')}</div>
      <Field label={t('common.name')}>
        <TextInput value={chapter.name} onChange={(v) => session.update(t('chapter.rename'), (d) => { const c = d.chapters.find((x) => x.id === chapter.id); if (c) c.name = v; })} />
      </Field>
      <Field label={t('chapter.entry')} hint={t('chapter.entryHint')}>
        <Select value={chapter.entryNodeId || ''} options={[{ value: '', label: `${t('chapter.auto')}${entry ? ` (${entry.name})` : ''}` }, ...nodes.filter((n) => n.type !== 'core.comment').map((n) => ({ value: n.id, label: n.name }))]}
          onChange={(v) => session.update(t('graph.setEntry'), (d) => { const c = d.chapters.find((x) => x.id === chapter.id); if (c) c.entryNodeId = v || null; })} />
      </Field>
      <Field label={t('chapter.notes')}>
        <TextInput multiline rows={4} value={chapter.notes || ''} placeholder={t('chapter.notesPlaceholder')} onChange={(v) => session.update(t('chapter.notes'), (d) => { const c = d.chapters.find((x) => x.id === chapter.id); if (c) c.notes = v; })} />
      </Field>
      <div className="stats">
        <div><b>{scenes.length}</b><span>{t('stats.scenes')}</span></div>
        <div><b>{nodes.length - scenes.length}</b><span>{t('stats.otherNodes')}</span></div>
        <div><b>{scenes.reduce((s, n) => s + (n.data as SceneData).dialogue.length, 0)}</b><span>{t('stats.lines')}</span></div>
      </div>
      <Button icon="play" onClick={() => session.setUI({ preview: { scope: 'chapter', nodeId: entry?.id || null, key: Date.now() } })} disabled={!entry}>{t('preview.chapter')}</Button>
      {issues.length > 0 ? <Section id="insp.ch.issues" title={t('problems.inChapter', { n: issues.length })}><IssueList session={session} issues={issues} /></Section>
        : <Empty icon="check" title={t('problems.noneInChapter')} />}
      <div className="muted small tip"><Icon name="info" size={13} /> {t('inspector.graphTip')} <IconButton icon="keyboard" size={13} title={t('shortcuts.title')} onClick={() => (globalThis as any).__vneStore?.open({ kind: 'shortcuts' })} /></div>
    </div>
  );
}
