import { useMemo, useState } from 'react';
import type { VarType, VariableDef, Character } from '@vne/core';
import { newId, variableUsage } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { Icon } from '../ui/Icon';
import { IconButton, Button, Select, TextInput, ColorInput, Section, cx } from '../ui/controls';
import { AssetPicker } from '../inspect/AssetPicker';
import { openMenu } from '../ui/Menu';
import { VariableModal, ItemModal, newItem, initialFor } from '../script/GameEditors';
import { CharacterLibraryButton } from '../library/LibraryPanels';
import { saveCharacterPreset } from '../library/library';

export function DataPanel({ session }: { session: ProjectSession }) {
  useSession(session);
  return (
    <div className="data-panel">
      <VariablesSection session={session} />
      <ItemsSection session={session} />
      <CharactersSection session={session} />
      <BehaviorsSection session={session} />
      <CompositionsSection session={session} />
    </div>
  );
}

function ItemsSection({ session }: { session: ProjectSession }) {
  const t = useT();
  const project = session.project;
  const [open, setOpen] = useState<string | null>(null);
  const url = (id: string | null) => { const a = id ? project.assets.find((x) => x.id === id) : null; return a ? session.assetUrl(a) : null; };
  return (
    <Section id="data.items" title={<>{t('items.title')} <span className="muted">{project.items.length}</span></>} tip={t('items.hint')} defaultOpen={project.items.length > 0}
      actions={<IconButton icon="plus" size={14} title={t('items.add')} onClick={() => setOpen(newItem(session))} />}>
      {!project.items.length && <div className="muted small pad">{t('items.empty')}</div>}
      {project.items.map((it) => (
        <button key={it.id} type="button" className="item-row" onClick={() => setOpen(it.id)} title={it.description || t('items.rowHint')}>
          {url(it.assetId) ? <img src={url(it.assetId)!} alt="" className="item-thumb" /> : <span className="item-thumb icon"><Icon name="gem" size={13} /></span>}
          <span className="item-name">{it.name}</span>
        </button>
      ))}
      {open && <ItemModal session={session} itemId={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function VariablesSection({ session }: { session: ProjectSession }) {
  const t = useT();
  const project = session.project;
  const usage = useMemo(() => variableUsage(project), [project]);
  const [editing, setEditing] = useState<string | null>(null);
  const add = () => {
    let n = project.variables.length + 1;
    while (project.variables.some((v) => v.name === `var${n}`)) n++;
    session.update(t('vars.add'), (d) => { d.variables.push({ id: newId('var'), name: `var${n}`, type: 'number', initial: 0, scope: 'game' }); });
  };
  const upd = (id: string, fn: (v: VariableDef) => void) => session.update(t('vars.edit'), (d) => { const v = d.variables.find((x) => x.id === id); if (v) fn(v); });
  return (
    <Section id="data.vars" title={<>{t('vars.title')} <span className="muted">{project.variables.length}</span></>} actions={<IconButton icon="plus" size={14} title={t('vars.add')} onClick={add} />}>
      {!project.variables.length && <div className="muted small pad">{t('vars.emptyText')}</div>}
      {project.variables.map((v) => {
        const used = usage.get(v.id)?.length || 0;
        const dup = project.variables.filter((x) => x.name === v.name).length > 1;
        return (
          <div key={v.id} className="var-row">
            <TextInput value={v.name} className={cx(dup && 'invalid')} onChange={(name) => upd(v.id, (x) => { x.name = name.trim() || x.name; })} ariaLabel={t('common.name')} />
            <Select value={v.type} title={t('vars.type')} options={[{ value: 'number', label: t('vars.number') }, { value: 'boolean', label: t('vars.boolean') }, { value: 'string', label: t('vars.string') }, { value: 'list', label: t('vars.list') }]} onChange={(type) => upd(v.id, (x) => { x.type = type as VarType; x.initial = initialFor(type as VarType); })} />
            {v.type === 'list'
              ? <button type="button" className="btn btn-sm narrow" title={t('vars.listItems')} onClick={() => setEditing(v.id)}>{t('vars.nItems', { n: Array.isArray(v.initial) ? v.initial.length : 0 })}</button>
              : v.type === 'boolean'
              ? <Select value={String(v.initial)} title={t('vars.initial')} options={[{ value: 'false', label: t('expr.false') }, { value: 'true', label: t('expr.true') }]} onChange={(x) => upd(v.id, (y) => { y.initial = x === 'true'; })} />
              : <TextInput value={String(v.initial)} className="narrow" ariaLabel={t('vars.initial')} onChange={(x) => upd(v.id, (y) => { y.initial = v.type === 'number' ? Number(x) || 0 : x; })} />}
            <IconButton icon="more" size={14} title={t('common.more')} onClick={(e) => openMenu(e, [
              { label: t('game.edit'), icon: 'settings', onClick: () => setEditing(v.id) },
              { separator: true },
              { header: true, label: t('vars.scope') },
              { label: t('vars.scope.game'), checked: v.scope === 'game', onClick: () => upd(v.id, (x) => { x.scope = 'game'; }) },
              { label: t('vars.scope.persistent'), checked: v.scope === 'persistent', hint: t('vars.scope.persistentHint'), onClick: () => upd(v.id, (x) => { x.scope = 'persistent'; }) },
              { separator: true },
              { label: t('vars.usedIn', { n: used }), disabled: true },
              { label: t('common.delete'), icon: 'trash', danger: true, onClick: async () => {
                if (used && !(await store.confirm(t('vars.deleteTitle'), t('vars.deleteUsed', { name: v.name, n: used }), t('common.delete'), true))) return;
                session.update(t('vars.delete'), (d) => { d.variables = d.variables.filter((x) => x.id !== v.id); });
              } },
            ])} />
            {v.scope === 'persistent' && <span className="var-badge" title={t('vars.scope.persistentHint')}>P</span>}
          </div>
        );
      })}
      {editing && <VariableModal session={session} varId={editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function CharactersSection({ session }: { session: ProjectSession }) {
  const t = useT();
  const project = session.project;
  const [open, setOpen] = useState<string | null>(null);
  const colors = ['#ffd38a', '#8ad4ff', '#ff9fb2', '#a8f0a0', '#d3b0ff', '#ffb46b'];
  const add = () => {
    const id = newId('chr');
    session.update(t('chars.add'), (d) => { d.characters.push({ id, name: t('chars.newName', { n: d.characters.length + 1 }), color: colors[d.characters.length % colors.length], portraits: [{ id: newId('prt'), name: t('chars.defaultPortrait'), assetId: null }] }); });
    setOpen(id);
  };
  const upd = (id: string, fn: (c: Character) => void) => session.update(t('chars.edit'), (d) => { const c = d.characters.find((x) => x.id === id); if (c) fn(c); });
  const assetUrl = (id: string) => { const a = project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };
  return (
    <Section id="data.chars" title={<>{t('chars.title')} <span className="muted">{project.characters.length}</span></>} actions={<><CharacterLibraryButton session={session} /><IconButton icon="plus" size={14} title={t('chars.add')} onClick={add} /></>}>
      {!project.characters.length && <div className="muted small pad">{t('chars.emptyText')}</div>}
      {project.characters.map((c) => (
        <div key={c.id} className={cx('char-card', open === c.id && 'open')}>
          <div className="char-head" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span className="char-dot" style={{ background: c.color }} />
            <span className="char-name">{c.name}</span>
            <span className="muted small">{c.rig?.parts.length ? t('chars.rigged', { n: (c.motions || []).length }) : t('chars.portraits', { n: c.portraits.length })}</span>
            <Icon name={open === c.id ? 'chevronUp' : 'chevronDown'} size={14} />
          </div>
          {open === c.id && (
            <div className="char-body">
              <div className="row-inline"><TextInput value={c.name} onChange={(v) => upd(c.id, (x) => { x.name = v; })} ariaLabel={t('common.name')} /></div>
              <div className="row-inline"><span className="muted small">{t('chars.nameColor')}</span><ColorInput value={c.color} onChange={(v, tr) => session.update(t('chars.edit'), (d) => { d.characters.find((x) => x.id === c.id)!.color = v; }, tr ? { mergeKey: `color-${c.id}` } : undefined)} /></div>
              <div className="row-label">{t('chars.portraitsTitle')}</div>
              {c.portraits.map((p, i) => (
                <div key={p.id} className="portrait-row">
                  <TextInput value={p.name} className="narrow" onChange={(v) => upd(c.id, (x) => { x.portraits[i].name = v; })} ariaLabel={t('chars.portraitName')} />
                  <AssetPicker project={project} kind="image" value={p.assetId} onChange={(v) => upd(c.id, (x) => { x.portraits[i].assetId = v; })} assetUrl={assetUrl} t={t} />
                  <IconButton icon="close" size={13} title={t('common.remove')} disabled={c.portraits.length <= 1} onClick={() => upd(c.id, (x) => { x.portraits.splice(i, 1); })} />
                </div>
              ))}
              <div className="row-inline char-studio-row">
                <Button small icon="bone" onClick={() => store.openStudio({ characterId: c.id })}>{t('studio.open')}</Button>
                <Button small icon="bookmarkPlus" kind="ghost" onClick={() => saveCharacterPreset(session, c.id)}>{t('lib.saveCharacter')}</Button>
              </div>
              <div className="row-inline">
                <Button small icon="plus" kind="ghost" onClick={() => upd(c.id, (x) => { x.portraits.push({ id: newId('prt'), name: t('chars.portraitN', { n: x.portraits.length + 1 }), assetId: null }); })}>{t('chars.addPortrait')}</Button>
                <span className="grow" />
                <Button small icon="trash" kind="ghost" onClick={async () => {
                  if (!(await store.confirm(t('chars.deleteTitle'), t('chars.deleteMessage', { name: c.name }), t('common.delete'), true))) return;
                  session.update(t('chars.delete'), (d) => { d.characters = d.characters.filter((x) => x.id !== c.id); });
                }}>{t('common.delete')}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function BehaviorsSection({ session }: { session: ProjectSession }) {
  const t = useT();
  const project = session.project;
  const add = () => {
    const id = newId('beh');
    session.update(t('beh.add'), (d) => { d.behaviors.push({ id, name: t('beh.newName', { n: d.behaviors.length + 1 }), body: [] }); });
    session.openCustom(`behavior:${id}`);
  };
  return (
    <Section id="data.beh" title={<>{t('beh.title')} <span className="muted">{project.behaviors.length}</span></>} actions={<IconButton icon="plus" size={14} title={t('beh.add')} onClick={add} />}>
      {!project.behaviors.length && <div className="muted small pad">{t('beh.emptyText')}</div>}
      {project.behaviors.map((b) => (
        <button key={b.id} type="button" className="link-row" onClick={() => session.openCustom(`behavior:${b.id}`)}>
          <Icon name="script" size={13} /><span>{b.name}</span><span className="muted small">{t('beh.blocks', { n: b.body.length })}</span>
        </button>
      ))}
    </Section>
  );
}

function CompositionsSection({ session }: { session: ProjectSession }) {
  const t = useT();
  const project = session.project;
  const uses = (id: string) => {
    let n = 0;
    for (const node of Object.values(project.nodes)) for (const l of ((node.data as any)?.layers || []) as { type: string; props: any }[]) if (l.type === 'core.composition' && l.props.compositionId === id) n++;
    for (const c of project.compositions) for (const l of c.layers) if (l.type === 'core.composition' && l.props.compositionId === id) n++;
    return n;
  };
  const rename = async (id: string, name: string) => {
    const v = await (globalThis as any).__vneStore.prompt(t('comp.rename'), t('comp.name'), name);
    if (v && v.trim()) session.update(t('comp.rename'), (d) => { const c = d.compositions.find((x) => x.id === id); if (c) c.name = v.trim(); });
  };
  const remove = async (id: string, name: string) => {
    const n = uses(id);
    if (n && !(await (globalThis as any).__vneStore.confirm(t('comp.deleteTitle'), t('comp.deleteUsed', { name, n }), t('common.delete'), true))) return;
    session.update(t('comp.delete'), (d) => { d.compositions = d.compositions.filter((c) => c.id !== id); });
  };
  return (
    <Section id="data.comp" title={<>{t('layer.compositions')} <span className="muted">{project.compositions.length}</span></>}>
      {!project.compositions.length && <div className="muted small pad">{t('comp.emptyText')}</div>}
      {project.compositions.map((c) => (
        <div key={c.id} className="link-row">
          <Icon name="layers" size={13} /><span>{c.name}</span>
          <span className="muted small">{t('comp.uses', { n: uses(c.id) })}</span>
          <IconButton icon="text" size={13} title={t('comp.rename')} onClick={() => rename(c.id, c.name)} />
          <IconButton icon="trash" size={13} title={t('comp.delete')} onClick={() => remove(c.id, c.name)} />
        </div>
      ))}
      {project.compositions.length > 0 && <div className="muted small pad">{t('comp.howToEdit')}</div>}
    </Section>
  );
}
