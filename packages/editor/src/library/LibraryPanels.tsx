/**
 * Library sections of the inspector's Presets tab: scene presets ("Scenes": save a group of
 * elements, add or switch it in another scene) and character presets ("Characters").
 */
import { useMemo, useState } from 'react';
import type { Layer, SceneData } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store, useT } from '../state/store';
import { Button, Checkbox, Field, IconButton, Section, TextInput, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { openMenu } from '../ui/Menu';
import { layerTree, setLayerProps } from '../scene/sceneOps';
import {
  LibraryEntry, addCharacterPreset, deleteLibraryEntry, loadScenePreset, presetGroups, presetable, renameLibraryEntry,
  saveCharacterPreset, saveScenePreset, useLibrary, withDescendants,
} from './library';

function entryMenu(session: ProjectSession, e: LibraryEntry, ev: { clientX: number; clientY: number }, extra: { label: string; icon: string; onClick: () => void }[] = []) {
  const t = session.i18n.t;
  openMenu(ev, [
    ...extra,
    { label: t('common.rename'), icon: 'text', onClick: () => renameLibraryEntry(session, e) },
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteLibraryEntry(session, e) },
  ]);
}

function LibCard({ entry, icon, onClick, onMore, busy, badge, primary }: { entry: LibraryEntry; icon: string; onClick: () => void; onMore: (ev: React.MouseEvent) => void; busy?: boolean; badge?: string; primary: string }) {
  return (
    <div className={cx('lib-card', busy && 'busy')}>
      <button type="button" className="lib-thumb" onClick={onClick} title={primary} disabled={busy}>
        {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <Icon name={icon} size={22} />}
        <span className="lib-apply">{primary}</span>
      </button>
      <div className="lib-meta">
        <span className="lib-name" title={entry.name}>{entry.name}</span>
        {badge && <span className="lib-badge">{badge}</span>}
        <IconButton icon="more" size={13} title={entry.name} onClick={(e) => onMore(e)} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- scenes */

export function ScenePresetsSection({ session, nodeId, scene, selected }: { session: ProjectSession; nodeId: string; scene: SceneData; selected: string[] }) {
  const t = useT();
  const list = useLibrary('scene');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = presetGroups(scene);
  const current = new Set(groups.map((g) => g.presetGroup));
  const run = async (id: string, replace: boolean) => {
    setBusy(id);
    try { await loadScenePreset(session, nodeId, id, { replace }); } finally { setBusy(null); }
  };
  return (
    <Section id="insp.presets.scenes" title={t('lib.scenes')} tip={t('lib.scenesTip')} actions={<IconButton icon="bookmarkPlus" size={14} title={t('lib.saveScene')} onClick={() => setSaving(true)} />}>
      {list === null ? <p className="muted small">{t('common.loading')}</p>
        : !list.length ? <div className="muted small">{t('lib.noScenes')} <Button small icon="bookmarkPlus" onClick={() => setSaving(true)}>{t('lib.saveScene')}</Button></div>
          : (
            <>
              {groups.length > 0 && <p className="muted small lib-note"><Icon name="swap" size={12} /> {t('lib.switchHint', { name: groups[0].name })}</p>}
              <div className="lib-grid">
                {list.map((e) => (
                  <LibCard key={e.id} entry={e} icon="scene" busy={busy === e.id} badge={current.has(e.id) ? t('lib.inUse') : undefined}
                    primary={groups.length ? t('lib.switch') : t('lib.add')}
                    onClick={() => run(e.id, groups.length > 0)}
                    onMore={(ev) => entryMenu(session, e, ev, [
                      { label: t('lib.switch'), icon: 'swap', onClick: () => run(e.id, true) },
                      { label: t('lib.addAlso'), icon: 'plus', onClick: () => run(e.id, false) },
                      { label: t('lib.replaceWithSelection'), icon: 'save', onClick: () => setSaving(true) },
                    ])} />
                ))}
              </div>
            </>
          )}
      {saving && <SaveSceneDialog session={session} nodeId={nodeId} scene={scene} selected={selected} onClose={() => setSaving(false)} />}
    </Section>
  );
}

function SaveSceneDialog({ session, nodeId, scene, selected, onClose }: { session: ProjectSession; nodeId: string; scene: SceneData; selected: string[]; onClose: () => void }) {
  const t = useT();
  const list = useLibrary('scene') || [];
  const tree = useMemo(() => layerTree(scene).filter(({ layer }) => presetable(layer)), [scene]);
  const [picked, setPicked] = useState<Set<string>>(() => {
    if (selected.length) return withDescendants(scene, selected);
    // Nothing selected: a loaded preset group, else every element.
    const g = presetGroups(scene)[0];
    return g ? withDescendants(scene, [g.id]) : new Set(tree.map((x) => x.layer.id));
  });
  const firstGroup = scene.layers.find((l) => picked.has(l.id) && l.presetGroup);
  const [name, setName] = useState(() => firstGroup?.name || session.project.nodes[nodeId]?.name || t('lib.sceneName'));
  const [busy, setBusy] = useState(false);
  const toggle = (l: Layer, on: boolean) => {
    const next = new Set(picked);
    for (const id of withDescendants(scene, [l.id])) { if (on) next.add(id); else next.delete(id); }
    // Picking a child keeps its groups so the arrangement holds.
    if (on) { let p = l.parentId; while (p) { next.add(p); p = scene.layers.find((x) => x.id === p)?.parentId || null; } }
    setPicked(next);
  };
  const same = list.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());
  const save = async () => {
    if (!picked.size || !name.trim()) return;
    if (same && !(await store.confirm(t('fxp.replaceTitle'), t('fxp.replaceText', { name: same.name }), t('fxp.replace')))) return;
    setBusy(true);
    const ok = await saveScenePreset(session, nodeId, [...picked], name.trim(), same?.id);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={t('lib.saveSceneTitle')} icon={<Icon name="bookmarkPlus" size={16} />} onClose={onClose} width={480}
      footer={<><span className="muted small grow">{t('lib.pickedCount', { n: picked.size })}</span><Button kind="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button kind="primary" icon="save" disabled={!picked.size || !name.trim() || busy} onClick={save}>{same ? t('fxp.replace') : t('common.save')}</Button></>}>
      <Field label={t('lib.name')}><TextInput value={name} onChange={setName} /></Field>
      <div className="row-inline lib-pick-head">
        <span className="row-label">{t('lib.pickElements')}</span><span className="grow" />
        <Button small kind="ghost" onClick={() => setPicked(new Set(tree.map((x) => x.layer.id)))}>{t('lib.all')}</Button>
        <Button small kind="ghost" onClick={() => setPicked(new Set())}>{t('lib.none')}</Button>
      </div>
      <div className="lib-pick">
        {tree.map(({ layer, depth }) => {
          const def = session.engine.layerTypes.get(layer.type);
          return (
            <div key={layer.id} className="lib-pick-row" style={{ paddingLeft: 6 + depth * 16 }}>
              <Checkbox value={picked.has(layer.id)} onChange={(v) => toggle(layer, v)} label={<><Icon name={def?.icon || 'layers'} size={13} /> {layer.name}</>} />
            </div>
          );
        })}
      </div>
      <p className="muted small">{t('lib.saveSceneHint')}</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- characters */

export function CharacterPresetsSection({ session, nodeId, layer }: { session: ProjectSession; nodeId?: string; layer?: Layer | null }) {
  const t = useT();
  const list = useLibrary('character');
  const [busy, setBusy] = useState<string | null>(null);
  const forLayer = layer && layer.type === 'core.character' && nodeId ? layer : null;
  const use = async (e: LibraryEntry) => {
    setBusy(e.id);
    try {
      const id = await addCharacterPreset(session, e.id);
      if (id && forLayer && nodeId) setLayerProps(session, nodeId, forLayer.id, { characterId: id, portraitId: null, motion: null, expression: null }, { label: t('lib.useCharacter') });
    } finally { setBusy(null); }
  };
  const saveOne = async (ev: React.MouseEvent) => {
    const chars = session.project.characters;
    if (!chars.length) { store.toast(t('lib.noProjectCharacters')); return; }
    const own = forLayer?.props.characterId && chars.find((c) => c.id === forLayer.props.characterId);
    const save = async (id: string) => {
      const ch = chars.find((c) => c.id === id)!;
      const same = (list || []).find((e) => e.name.trim().toLowerCase() === ch.name.trim().toLowerCase());
      if (same && !(await store.confirm(t('fxp.replaceTitle'), t('fxp.replaceText', { name: same.name }), t('fxp.replace')))) return;
      await saveCharacterPreset(session, id, same?.id);
    };
    if (own) { await save(own.id); return; }
    openMenu(ev, chars.map((c) => ({ label: c.name, icon: 'user', onClick: () => save(c.id) })), { title: t('lib.saveWhichCharacter') });
  };
  return (
    <Section id="insp.presets.characters" title={t('lib.characters')} tip={t('lib.charactersTip')} actions={<IconButton icon="bookmarkPlus" size={14} title={t('lib.saveCharacter')} onClick={saveOne} />}>
      {list === null ? <p className="muted small">{t('common.loading')}</p>
        : !list.length ? <div className="muted small">{t('lib.noCharacters')} <Button small icon="bookmarkPlus" onClick={saveOne}>{t('lib.saveCharacter')}</Button></div>
          : (
            <div className="lib-grid chars">
              {list.map((e) => {
                const d: any = e.data || {};
                return (
                  <LibCard key={e.id} entry={e} icon="user" busy={busy === e.id}
                    badge={d.rig?.parts?.length ? t('lib.rigged') : d.motions?.length ? t('lib.motions', { n: d.motions.length }) : undefined}
                    primary={forLayer ? t('lib.useHere') : t('lib.addToProject')}
                    onClick={() => use(e)}
                    onMore={(ev) => entryMenu(session, e, ev, [{ label: t('lib.addToProject'), icon: 'plus', onClick: () => { setBusy(e.id); addCharacterPreset(session, e.id).finally(() => setBusy(null)); } }])} />
                );
              })}
            </div>
          )}
    </Section>
  );
}

/** A compact picker used where a whole section does not fit (the Data panel). */
export function CharacterLibraryButton({ session }: { session: ProjectSession }) {
  const t = useT();
  const list = useLibrary('character');
  return (
    <IconButton icon="library" size={14} title={t('lib.addFromLibrary')} onClick={(ev) => {
      if (!list?.length) { store.toast(t('lib.noCharacters')); return; }
      openMenu(ev, list.map((e) => ({ label: e.name, icon: 'user', onClick: () => addCharacterPreset(session, e.id) })), { title: t('lib.characters') });
    }} />
  );
}

