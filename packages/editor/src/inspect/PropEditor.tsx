import { ReactNode } from 'react';
import type { PropDef, Project, SceneData } from '@vne/core';
import { sceneChoices } from '@vne/core';
import { ExprInput } from '../script/ExprInput';
import { NumberInput, TextInput, ColorInput, Select, Toggle, Field, Section, IconButton, cx } from '../ui/controls';
import { AssetPicker } from './AssetPicker';
import { store } from '../state/store';
import { importFiles } from '../sidebar/AssetLibrary';
import { resolveFontFamily } from '@vne/runtime';

export interface PropContext {
  project: Project;
  scene?: SceneData | null;
  t: (k: string, p?: any) => string;
  assetUrl: (assetId: string) => string | null;
  /** Current values, used by dependent fields (portrait depends on character). */
  values: Record<string, any>;
  /** Keyframe UI: returns state of the prop on the current clip. */
  keyState?: (key: string) => 'none' | 'animated' | 'key';
  onToggleKey?: (key: string) => void;
  /** Props that are animated: inspector shows the value at the playhead. */
  layerId?: string;
}

const FONT_PRESETS = [
  'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
  'Georgia, "Songti SC", "SimSun", serif',
  '"Hiragino Mincho ProN", "Songti SC", serif',
  '"Courier New", monospace',
  'Impact, "Arial Black", sans-serif',
];

/**
 * Font choice: system fonts, imported font files (with an Upload button that imports
 * .ttf/.otf/.woff/.woff2 into the project) or any CSS font-family.
 */
export function FontPicker({ project, value, onChange, t }: { project: Project; value: any; onChange: (v: any) => void; t: (k: string, p?: any) => string }) {
  const fonts = project.assets.filter((a) => a.kind === 'font');
  const known = [...FONT_PRESETS, ...fonts.map((f) => f.id)];
  const upload = async () => {
    const s = store.session;
    if (!s) return;
    const paths = await store.pickFiles(t('font.uploadTitle'), [{ name: t('font.files'), extensions: ['ttf', 'otf', 'woff', 'woff2'] }]);
    if (!paths?.length) return;
    const assets = await importFiles(s, paths);
    const font = assets.find((a) => a.kind === 'font');
    if (font) { s.assets.loadFonts(); onChange(font.id); store.toast(t('font.uploaded', { name: font.name }), 'success'); }
    else store.toast(t('font.notAFont'), 'error');
  };
  const current = fonts.find((f) => f.id === value);
  return (
    <div className="stack-sm">
      <div className="font-pick">
        <Select value={known.includes(value) ? value : '__custom'} options={[
          ...FONT_PRESETS.map((f, i) => ({ value: f, label: t(`font.preset${i}`), group: t('font.system') })),
          ...fonts.map((f) => ({ value: f.id, label: f.name, group: t('font.imported') })),
          { value: '__custom', label: t('font.custom'), group: t('font.other') },
        ]} onChange={(v) => { if (v !== '__custom') onChange(v); else onChange(''); }} />
        <IconButton icon="upload" size={14} title={t('font.upload')} onClick={upload} />
      </div>
      {current && <div className="font-preview" style={{ fontFamily: resolveFontFamily(project, current.id) }}>Aa 永字 The quick brown fox</div>}
      {!known.includes(value) && <TextInput value={String(value ?? '')} onChange={(v) => onChange(v)} placeholder="CSS font-family" />}
    </div>
  );
}

export function PropField({ def, value, onChange, ctx, label }: { def: PropDef; value: any; onChange: (v: any, transient?: boolean) => void; ctx: PropContext; label?: ReactNode }) {
  const t = ctx.t;
  const l = label ?? t(def.label);
  const keyState = def.animatable && ctx.keyState ? ctx.keyState(def.key) : null;
  const keyBtn = keyState ? (
    <IconButton icon="keyframe" size={12} className={cx('key-toggle', keyState)} title={keyState === 'key' ? t('timeline.removeKey') : t('timeline.addKey')} onClick={() => ctx.onToggleKey?.(def.key)} />
  ) : null;
  let control: ReactNode;
  switch (def.type) {
    case 'number':
      control = <NumberInput value={Number(value ?? def.default ?? 0)} min={def.min} max={def.max} step={def.step ?? 1} unit={def.unit} onChange={onChange} />;
      break;
    case 'boolean':
      control = <Toggle value={!!value} onChange={(v) => onChange(v)} />;
      break;
    case 'color':
      control = <ColorInput value={String(value ?? def.default ?? '#ffffff')} onChange={onChange} title={l as string} />;
      break;
    case 'text':
      control = <TextInput multiline rows={3} value={String(value ?? '')} onChange={(v) => onChange(v)} />;
      break;
    case 'select':
      control = <Select value={value ?? def.default} options={(def.options || []).map((o) => ({ value: o.value, label: t(o.label) }))} onChange={(v) => onChange(v)} />;
      break;
    case 'asset':
      control = <AssetPicker project={ctx.project} kind={def.assetKind} value={value || null} onChange={(v) => onChange(v)} assetUrl={ctx.assetUrl} t={t} />;
      break;
    case 'character':
      control = <Select value={value || ''} placeholder={t('common.none')} options={[{ value: '', label: t('common.none') }, ...ctx.project.characters.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => onChange(v || null)} />;
      break;
    case 'portrait': {
      const ch = ctx.project.characters.find((c) => c.id === ctx.values.characterId);
      control = <Select value={value || ''} placeholder={t('prop.portrait.default')} options={[{ value: '', label: t('prop.portrait.default') }, ...(ch?.portraits || []).map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => onChange(v || null)} disabled={!ch} />;
      break;
    }
    case 'motion':
    case 'expression': {
      const ch = ctx.project.characters.find((c) => c.id === ctx.values.characterId);
      const list: { id: string; name: string }[] = (def.type === 'motion' ? ch?.motions : ch?.expressions) || [];
      const none = t(def.type === 'motion' ? 'prop.motion.default' : 'prop.expression.default');
      control = <Select value={value || ''} placeholder={none} options={[{ value: '', label: none }, ...list.map((m) => ({ value: m.id, label: m.name }))]} onChange={(v) => onChange(v || null)} disabled={!ch || !list.length} />;
      break;
    }
    case 'variable':
      control = <Select value={value || ''} placeholder={t('common.choose')} options={[...ctx.project.variables.map((v) => ({ value: v.id, label: v.name, group: t('vars.project') })), ...(ctx.scene?.localVariables || []).map((v) => ({ value: v.id, label: v.name, group: t('vars.scene') }))]} onChange={(v) => onChange(v)} />;
      break;
    case 'layer':
      control = <Select value={value || ''} placeholder={t('common.choose')} options={(ctx.scene?.layers || []).map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => onChange(v)} />;
      break;
    case 'item':
      control = <Select value={value || ''} placeholder={t('items.none')} options={[{ value: '', label: t('items.none') }, ...ctx.project.items.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => onChange(v || null)} />;
      break;
    case 'animation':
      control = <Select value={value || ''} placeholder={t('common.choose')} options={(ctx.scene?.animations || []).map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => onChange(v)} />;
      break;
    case 'choice':
      control = <Select value={value || ''} placeholder={t('common.choose')} options={(ctx.scene ? sceneChoices(ctx.scene) : []).map((x) => ({ value: x.id, label: x.text || '—' }))} onChange={(v) => onChange(v)} />;
      break;
    case 'expr':
      control = <ExprInput value={value || null} ctx={{ project: ctx.project, scene: ctx.scene || undefined, t } as any} placeholder={t('choice.alwaysAvailable')} onChange={(e) => onChange(e)} />;
      break;
    case 'node':
      control = <Select value={value || ''} placeholder={t('common.choose')} options={Object.values(ctx.project.nodes).filter((n) => n.type !== 'core.comment').map((n) => ({ value: n.id, label: n.name, group: ctx.project.chapters.find((c) => c.id === n.chapterId)?.name }))} onChange={(v) => onChange(v)} />;
      break;
    case 'font':
      control = <FontPicker project={ctx.project} value={value} onChange={onChange} t={t} />;
      break;
    case 'composition':
      control = <Select value={value || ''} placeholder={t('common.choose')} options={ctx.project.compositions.map((c) => ({ value: c.id, label: c.animation ? `${c.name} · ${t('comp.animated')}` : c.name }))} onChange={(v) => onChange(v || null)} />;
      break;
    case 'json':
      control = <code className="json-view">{JSON.stringify(value)}</code>;
      break;
    default:
      control = <TextInput value={String(value ?? '')} onChange={(v) => onChange(v)} />;
  }
  return <Field label={<>{l}{keyBtn}</>} hint={def.description ? t(def.description) : undefined}>{control}</Field>;
}

/** Generated form for a property schema, grouped into collapsible sections. */
export function PropEditor({ defs, values, onChange, ctx, groupLabels, idPrefix }: {
  defs: PropDef[]; values: Record<string, any>; onChange: (key: string, v: any, transient?: boolean) => void; ctx: PropContext; groupLabels?: Record<string, string>; idPrefix?: string;
}) {
  const visible = defs.filter((d) => !d.hidden);
  const groups = new Map<string, PropDef[]>();
  for (const d of visible) {
    const g = d.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(d);
  }
  const renderGroup = (list: PropDef[]) => {
    // transform: x/y and scale pairs side by side
    const out: ReactNode[] = [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const pair = list[i + 1];
      const pairable = d.type === 'number' && pair?.type === 'number' && ((d.key === 'x' && pair.key === 'y') || (d.key === 'scaleX' && pair.key === 'scaleY') || (d.key === 'anchorX' && pair.key === 'anchorY') || (d.key === 'width' && pair.key === 'height'));
      if (pairable) {
        out.push(
          <div className="field-pair" key={d.key}>
            <PropField def={d} value={values[d.key]} onChange={(v, tr) => onChange(d.key, v, tr)} ctx={ctx} />
            <PropField def={pair} value={values[pair.key]} onChange={(v, tr) => onChange(pair.key, v, tr)} ctx={ctx} />
          </div>,
        );
        i++;
      } else out.push(<PropField key={d.key} def={d} value={values[d.key]} onChange={(v, tr) => onChange(d.key, v, tr)} ctx={ctx} />);
    }
    return out;
  };
  return (
    <>
      {[...groups].map(([g, list]) => (g ? (
        <Section key={g} id={`${idPrefix || 'props'}.${g}`} title={ctx.t(groupLabels?.[g] || `group.${g}`)}>{renderGroup(list)}</Section>
      ) : <div key="_" className="section-body">{renderGroup(list)}</div>))}
    </>
  );
}
