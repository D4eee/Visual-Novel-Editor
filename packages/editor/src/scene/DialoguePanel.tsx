import { useEffect, useRef, useState } from 'react';
import type { DialogueLine } from '@vne/core';
import { createDialogueLine } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { sceneOf, updateScene } from './sceneOps';
import { IconButton, Select, NumberInput, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu } from '../ui/Menu';
import { AssetPicker } from '../inspect/AssetPicker';

/**
 * Lines of a scene's dialogue element, edited in the inspector: type, Enter for
 * the next line, Tab to cycle the speaker. The selected line is previewed in the
 * real text box on the canvas.
 */
export function DialogueLines({ session, nodeId, layerId }: { session: ProjectSession; nodeId: string; layerId: string }) {
  useSession(session);
  const t = useT();
  const sceneData = sceneOf(session, nodeId)!;
  const layer = sceneData.layers.find((l) => l.id === layerId);
  const scene = { dialogue: (Array.isArray(layer?.props.lines) ? layer!.props.lines : []) as DialogueLine[] };
  const ui = session.sceneUI(nodeId);
  const project = session.project;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const speakers = [{ value: '', label: t('dialogue.narrator') }, ...project.characters.map((c) => ({ value: c.id, label: c.name }))];

  // Edits operate on the dialogue element's lines.
  const upd = (label: string, fn: (s: { dialogue: DialogueLine[] }) => void, mk?: string) => updateScene(session, nodeId, label, (sd) => {
    const l = sd.layers.find((x) => x.id === layerId);
    if (!l) return;
    if (!Array.isArray(l.props.lines)) l.props.lines = [];
    fn({ get dialogue() { return l.props.lines as DialogueLine[]; } });
  }, mk);
  const insertAfter = (index: number, speakerId: string | null) => {
    const line = createDialogueLine('', speakerId);
    upd(t('dialogue.add'), (s) => { s.dialogue.splice(index + 1, 0, line); });
    setFocusId(line.id);
    session.setSceneUI(nodeId, { selectedLine: line.id });
  };

  const cycleSpeaker = (l: DialogueLine, dir: 1 | -1) => {
    const ids = speakers.map((s) => s.value);
    const i = ids.indexOf(l.speakerId || '');
    const next = ids[(i + dir + ids.length) % ids.length];
    upd(t('dialogue.speaker'), (s) => { const x = s.dialogue.find((y) => y.id === l.id)!; x.speakerId = next || null; x.portraitId = null; });
  };

  return (
    <div className="dialogue-panel" title={`Enter: ${t('dialogue.newLine')} · Shift+Enter: ${t('dialogue.lineBreak')} · Tab: ${t('dialogue.nextSpeaker')}`}>
      <div className="dialogue-lines">
        <div className="lines">
          {scene.dialogue.map((l, i) => {
            const ch = project.characters.find((c) => c.id === l.speakerId);
            return (
              <div key={l.id} className={cx('line-row', ui.selectedLine === l.id && 'active', dragging === l.id && 'dragging')}
                onClick={() => session.setSceneUI(nodeId, { selectedLine: l.id })}
                onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                onDrop={() => { if (!dragging || dragging === l.id) return; upd(t('dialogue.reorder'), (s) => { const from = s.dialogue.findIndex((x) => x.id === dragging); const [m] = s.dialogue.splice(from, 1); s.dialogue.splice(i, 0, m); }); setDragging(null); }}>
                <span className="drag-handle" draggable onDragStart={() => setDragging(l.id)} onDragEnd={() => setDragging(null)} title={t('common.dragToReorder')}><Icon name="grip" size={14} /></span>
                <span className="line-num">{i + 1}</span>
                <div className="line-speaker">
                  <span className="char-dot" style={{ background: ch?.color || 'var(--muted)' }} />
                  <Select value={l.speakerId || ''} options={l.speakerId || !l.speakerName ? speakers : [{ value: '', label: l.speakerName }, ...speakers.slice(1)]} onChange={(v) => upd(t('dialogue.speaker'), (s) => { const x = s.dialogue.find((y) => y.id === l.id)!; x.speakerId = v || null; x.portraitId = null; })} title={t('dialogue.speaker')} />
                  {ch && ch.portraits.length > 1 && <Select value={l.portraitId || ''} options={[{ value: '', label: t('prop.portrait.default') }, ...ch.portraits.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => upd(t('dialogue.portrait'), (s) => { s.dialogue.find((y) => y.id === l.id)!.portraitId = v || null; })} title={t('dialogue.portrait')} />}
                </div>
                <LineText value={l.text} focus={focusId === l.id} onFocused={() => { setFocusId(null); session.setSceneUI(nodeId, { selectedLine: l.id }); }}
                  placeholder={i === 0 ? t('dialogue.firstPlaceholder') : t('dialogue.placeholder')}
                  onChange={(v) => upd(t('dialogue.edit'), (s) => { const x = s.dialogue.find((y) => y.id === l.id); if (x) x.text = v; }, `line-${l.id}`)}
                  onEnter={() => insertAfter(i, l.speakerId)}
                  onTab={(dir) => cycleSpeaker(l, dir)}
                  onBackspaceEmpty={() => {
                    if (scene.dialogue.length <= 1) return;
                    const prev = scene.dialogue[i - 1];
                    upd(t('dialogue.delete'), (s) => { s.dialogue.splice(i, 1); });
                    if (prev) setFocusId(prev.id);
                  }}
                  onArrow={(dir) => { const other = scene.dialogue[i + dir]; if (other) setFocusId(other.id); }} />
                <IconButton icon="more" size={14} title={t('dialogue.lineOptions')} onClick={(e) => openMenu(e, [
                  { label: t('dialogue.insertAbove'), icon: 'arrowUp', onClick: () => insertAfter(i - 1, l.speakerId) },
                  { label: t('dialogue.insertBelow'), icon: 'arrowDown', onClick: () => insertAfter(i, l.speakerId) },
                  { label: t('dialogue.autoAdvance'), icon: 'clock', submenu: [0, 1, 2, 3, 5].map((s) => ({ label: s ? `${s}s` : t('dialogue.waitClick'), checked: (l.auto || 0) === s, onClick: () => upd(t('dialogue.edit'), (sc) => { sc.dialogue.find((y) => y.id === l.id)!.auto = s; }) })) },
                  { label: t('dialogue.playFromHere'), icon: 'play', onClick: () => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now() } }) },
                  { separator: true },
                  { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => upd(t('dialogue.delete'), (s) => { s.dialogue.splice(i, 1); }) },
                ])} />
                {ui.selectedLine === l.id && (
                  <div className="line-extra" onClick={(e) => e.stopPropagation()}>
                    {!l.speakerId && <>
                      <span className="muted small">{t('dialogue.speakerName')}</span>
                      <input className="input speaker-name" value={l.speakerName || ''} placeholder={t('dialogue.narrator')} aria-label={t('dialogue.speakerName')}
                        onChange={(e) => upd(t('dialogue.edit'), (s) => { s.dialogue.find((y) => y.id === l.id)!.speakerName = e.target.value || undefined; }, `name-${l.id}`)} />
                    </>}
                    <span className="muted small">{t('dialogue.voice')}</span>
                    <AssetPicker project={project} kind="audio" value={l.voiceAssetId || null} t={t} assetUrl={(id) => { const a = project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; }} onChange={(v) => upd(t('dialogue.voice'), (s) => { s.dialogue.find((y) => y.id === l.id)!.voiceAssetId = v; })} />
                    <span className="muted small">{t('dialogue.auto')}</span>
                    <NumberInput value={l.auto || 0} min={0} step={0.5} unit="s" onChange={(v) => upd(t('dialogue.edit'), (s) => { s.dialogue.find((y) => y.id === l.id)!.auto = v; }, `auto-${l.id}`)} />
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="add-line" onClick={() => insertAfter(scene.dialogue.length - 1, scene.dialogue[scene.dialogue.length - 1]?.speakerId ?? null)}>
            <Icon name="plus" size={14} /> {scene.dialogue.length ? t('dialogue.add') : t('dialogue.addFirst')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineText({ value, onChange, onEnter, onTab, onBackspaceEmpty, onArrow, focus, onFocused, placeholder }: {
  value: string; onChange: (v: string) => void; onEnter: () => void; onTab: (dir: 1 | -1) => void; onBackspaceEmpty: () => void; onArrow: (dir: 1 | -1) => void;
  focus: boolean; onFocused: () => void; placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  useEffect(() => { if (focus) { ref.current?.focus(); onFocused(); } }, [focus]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [draft]);
  return (
    <textarea ref={ref} className="line-text" rows={1} value={draft} placeholder={placeholder} spellCheck aria-label={placeholder}
      onFocus={() => { focused.current = true; onFocused(); }}
      onBlur={() => { focused.current = false; if (draft !== value) onChange(draft); }}
      onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft !== value) onChange(draft); onEnter(); }
        else if (e.key === 'Tab') { e.preventDefault(); onTab(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Backspace' && draft === '') { e.preventDefault(); onBackspaceEmpty(); }
        else if (e.key === 'ArrowUp' && (e.target as HTMLTextAreaElement).selectionStart === 0) { e.preventDefault(); onArrow(-1); }
        else if (e.key === 'ArrowDown' && (e.target as HTMLTextAreaElement).selectionEnd === draft.length) { e.preventDefault(); onArrow(1); }
      }} />
  );
}
