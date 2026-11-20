import { useMemo, useState } from 'react';
import type { SceneData, StoryNode } from '@vne/core';
import { createChapter, nodesInChapter, deleteNodes } from '@vne/core';
import { stripMarkup } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { Icon } from '../ui/Icon';
import { IconButton, cx } from '../ui/controls';
import { openMenu } from '../ui/Menu';

function sceneNum(n: StoryNode): number {
  const v = parseFloat((n.data as SceneData)?.number);
  return Number.isFinite(v) ? v : 1e9;
}

export function StoryOutline({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const project = session.project;
  const ui = session.ui;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ui.chapterId]));
  const [dragChapter, setDragChapter] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return Object.values(project.nodes).filter((n) => {
      if (n.name.toLowerCase().includes(q)) return true;
      if (n.type === 'core.scene') {
        const d = n.data as SceneData;
        if (d.number === q || `#${d.number}` === q) return true;
        return d.dialogue.some((l) => l.text.toLowerCase().includes(q)) || d.choices.some((c) => c.text.toLowerCase().includes(q));
      }
      return false;
    }).slice(0, 80);
  }, [query, project.nodes]);

  const addChapter = () => {
    const c = createChapter(t('chapter.newName', { n: project.chapters.length + 1 }));
    session.update(t('chapter.add'), (d) => { d.chapters.push(c); });
    session.setUI({ chapterId: c.id, overview: false, active: 0 });
    setEditing(c.id);
    setExpanded(new Set([...expanded, c.id]));
  };

  const deleteChapter = async (id: string) => {
    if (project.chapters.length <= 1) { store.toast(t('chapter.cannotDeleteLast'), 'error'); return; }
    const ch = project.chapters.find((c) => c.id === id)!;
    const nodes = nodesInChapter(project, id);
    const target = project.chapters.find((c) => c.id !== id)!;
    if (nodes.length) {
      const ok = await store.confirm(t('chapter.deleteTitle', { name: ch.name }), t('chapter.deleteMessage', { n: nodes.length, target: target.name }), t('chapter.deleteMove'));
      if (!ok) return;
    }
    session.update(t('chapter.delete'), (d) => {
      for (const n of Object.values(d.nodes)) if (n.chapterId === id) n.chapterId = target.id;
      d.chapters = d.chapters.filter((c) => c.id !== id);
    });
    session.setUI({ chapterId: target.id });
  };

  const deleteChapterAndNodes = async (id: string) => {
    if (project.chapters.length <= 1) { store.toast(t('chapter.cannotDeleteLast'), 'error'); return; }
    const ch = project.chapters.find((c) => c.id === id)!;
    const nodes = nodesInChapter(project, id);
    const ok = await store.confirm(t('chapter.deleteTitle', { name: ch.name }), t('chapter.deleteAllMessage', { n: nodes.length }), t('common.delete'), true);
    if (!ok) return;
    const target = project.chapters.find((c) => c.id !== id)!;
    session.update(t('chapter.delete'), (d) => { deleteNodes(d, nodes.map((n) => n.id)); d.chapters = d.chapters.filter((c) => c.id !== id); });
    session.setUI({ chapterId: target.id });
  };

  const nodeRow = (n: StoryNode, showChapter = false) => {
    const def = session.engine.nodeTypes.get(n.type);
    const active = ui.selection.nodes.includes(n.id) || (session.activeTab.kind === 'node' && (session.activeTab as any).nodeId === n.id);
    const issue = session.issues.find((i) => i.target?.nodeId === n.id && i.severity === 'error');
    return (
      <button key={n.id} type="button" className={cx('outline-node', active && 'active')} style={{ ['--node-color' as any]: def?.color || '#666' }}
        onClick={() => session.focusNode(n.id)} onDoubleClick={() => session.openNode(n.id)}
        draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-vne-node', n.id); e.dataTransfer.effectAllowed = 'move'; }}
        title={n.type === 'core.scene' ? stripMarkup((n.data as SceneData).dialogue[0]?.text || '') : undefined}>
        <Icon name={def?.icon || 'module'} size={13} className="outline-icon" />
        {n.type === 'core.scene' && <span className="scene-num">{(n.data as SceneData).number}</span>}
        <span className="outline-name">{n.name}</span>
        {showChapter && <span className="outline-ch">{project.chapters.find((c) => c.id === n.chapterId)?.name}</span>}
        {issue && <Icon name="error" size={12} className="err" />}
      </button>
    );
  };

  return (
    <div className="outline">
      <div className="side-search">
        <Icon name="search" size={14} />
        <input placeholder={t('outline.search')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setQuery(''); }} aria-label={t('outline.search')} />
        {query && <IconButton icon="close" size={12} title={t('common.clear')} onClick={() => setQuery('')} />}
      </div>
      {results ? (
        <div className="outline-results">
          {results.length ? results.map((n) => nodeRow(n, true)) : <div className="muted small pad">{t('common.noResults')}</div>}
        </div>
      ) : (
        <>
          <div className="side-head">
            <span>{t('outline.chapters')}</span>
            <IconButton icon="plus" size={14} title={t('chapter.add')} onClick={addChapter} />
          </div>
          <button type="button" className={cx('chapter-row', 'overview', ui.overview && session.ui.active === 0 && 'active')} onClick={() => session.setUI({ overview: true, active: 0 })}>
            <Icon name="book" size={14} /><span className="outline-name">{t('graph.overview')}</span>
          </button>
          {project.chapters.map((c, idx) => {
            const nodes = nodesInChapter(project, c.id);
            const scenes = nodes.filter((n) => n.type === 'core.scene').sort((a, b) => sceneNum(a) - sceneNum(b));
            const others = nodes.filter((n) => n.type !== 'core.scene' && n.type !== 'core.comment');
            const open = expanded.has(c.id);
            const active = !ui.overview && ui.chapterId === c.id && session.ui.active === 0;
            const errors = session.issues.filter((i) => i.target?.chapterId === c.id && i.severity === 'error').length;
            return (
              <div key={c.id} className={cx('chapter', dropOn === c.id && 'drop')}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-vne-node') || (dragChapter && dragChapter !== c.id)) { e.preventDefault(); setDropOn(c.id); } }}
                onDragLeave={() => setDropOn((d) => (d === c.id ? null : d))}
                onDrop={(e) => {
                  setDropOn(null);
                  const nodeId = e.dataTransfer.getData('application/x-vne-node');
                  if (nodeId && project.nodes[nodeId] && project.nodes[nodeId].chapterId !== c.id) {
                    const ids = ui.selection.nodes.includes(nodeId) ? ui.selection.nodes : [nodeId];
                    session.update(t('graph.moveToChapter'), (d) => { for (const id of ids) if (d.nodes[id]) d.nodes[id].chapterId = c.id; });
                    store.toast(t('graph.moved', { n: ids.length, chapter: c.name }), 'success');
                  } else if (dragChapter && dragChapter !== c.id) {
                    session.update(t('chapter.reorder'), (d) => { const from = d.chapters.findIndex((x) => x.id === dragChapter); const [m] = d.chapters.splice(from, 1); d.chapters.splice(d.chapters.findIndex((x) => x.id === c.id) + (from <= idx ? 1 : 0), 0, m); });
                  }
                  setDragChapter(null);
                }}>
                <div className={cx('chapter-row', active && 'active')} draggable={editing !== c.id}
                  onDragStart={(e) => { setDragChapter(c.id); e.dataTransfer.setData('text/plain', c.name); }}
                  onDragEnd={() => setDragChapter(null)}
                  onClick={() => session.setUI({ chapterId: c.id, overview: false, active: 0 })}
                  onDoubleClick={() => setEditing(c.id)}
                  onContextMenu={(e) => { e.preventDefault(); openMenu(e, [
                    { label: t('common.rename'), icon: 'text', onClick: () => setEditing(c.id) },
                    { label: t('chapter.add'), icon: 'plus', onClick: addChapter },
                    { label: t('preview.chapter'), icon: 'play', onClick: () => session.setUI({ preview: { scope: 'chapter', nodeId: null, key: Date.now() }, chapterId: c.id }) },
                    { separator: true },
                    { label: t('chapter.moveUp'), icon: 'arrowUp', disabled: idx === 0, onClick: () => session.update(t('chapter.reorder'), (d) => { const [m] = d.chapters.splice(idx, 1); d.chapters.splice(idx - 1, 0, m); }) },
                    { label: t('chapter.moveDown'), icon: 'arrowDown', disabled: idx === project.chapters.length - 1, onClick: () => session.update(t('chapter.reorder'), (d) => { const [m] = d.chapters.splice(idx, 1); d.chapters.splice(idx + 1, 0, m); }) },
                    { separator: true },
                    { label: t('chapter.deleteKeep'), icon: 'trash', onClick: () => deleteChapter(c.id), disabled: project.chapters.length <= 1 },
                    { label: t('chapter.deleteWithNodes'), icon: 'trash', danger: true, onClick: () => deleteChapterAndNodes(c.id), disabled: project.chapters.length <= 1 },
                  ]); }}>
                  <button type="button" className="twisty" onClick={(e) => { e.stopPropagation(); const s = new Set(expanded); if (open) s.delete(c.id); else s.add(c.id); setExpanded(s); }} aria-label={open ? t('common.collapse') : t('common.expand')}>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
                  </button>
                  {editing === c.id ? (
                    <input className="inline-edit" autoFocus defaultValue={c.name} onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) session.update(t('chapter.rename'), (d) => { d.chapters.find((x) => x.id === c.id)!.name = v; }); setEditing(null); }}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                  ) : <span className="outline-name">{c.name}</span>}
                  {errors > 0 && <span className="count err" title={t('problems.inChapter', { n: errors })}>{errors}</span>}
                  <span className="count">{scenes.length}</span>
                </div>
                {open && (
                  <div className="chapter-nodes">
                    {scenes.map((n) => nodeRow(n))}
                    {others.map((n) => nodeRow(n))}
                    {!nodes.length && <div className="muted small pad">{t('outline.emptyChapter')}</div>}
                  </div>
                )}
              </div>
            );
          })}
          <div className="muted small pad tip">{t('outline.dragTip')}</div>
        </>
      )}
    </div>
  );
}
