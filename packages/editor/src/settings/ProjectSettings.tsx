import { FontPicker } from '../inspect/PropEditor';
import type { ProjectSettings as PS } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { Modal } from '../ui/Modal';
import { Field, TextInput, NumberInput, Select, Toggle, ColorInput, Section, Button } from '../ui/controls';
import { AssetPicker } from '../inspect/AssetPicker';
import { Icon } from '../ui/Icon';

export function ProjectSettingsDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const s = session.project.settings;
  const tb = s.textbox;
  const upd = (fn: (x: PS) => void, mk?: string) => session.update(t('settings.edit'), (d) => fn(d.settings), mk ? { mergeKey: mk } : undefined);
  const assetUrl = (id: string) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };
  return (
    <Modal title={t('settings.title')} onClose={onClose} width={720} icon={<Icon name="settings" size={18} />} footer={<Button kind="primary" onClick={onClose}>{t('common.done')}</Button>}>
      <div className="export-grid">
        <div>
          <Section id="set.game" title={t('settings.game')}>
            <Field label={t('settings.projectName')}><TextInput value={session.project.name} onChange={(v) => session.update(t('settings.edit'), (d) => { d.name = v; })} /></Field>
            <Field label={t('export.gameTitle')}><TextInput value={s.title} onChange={(v) => upd((x) => { x.title = v; })} /></Field>
            <Field label={t('settings.description')}><TextInput multiline value={s.description || ''} onChange={(v) => upd((x) => { x.description = v; })} /></Field>
            <div className="field-pair">
              <Field label={t('settings.width')}><NumberInput value={s.resolution.width} min={320} onChange={(v) => upd((x) => { x.resolution.width = Math.round(v); }, 'resw')} /></Field>
              <Field label={t('settings.height')}><NumberInput value={s.resolution.height} min={240} onChange={(v) => upd((x) => { x.resolution.height = Math.round(v); }, 'resh')} /></Field>
            </div>
          </Section>
          <Section id="set.text" title={t('settings.reading')}>
            <Field label={t('settings.textSpeed')} hint={t('settings.textSpeedHint')}><NumberInput value={s.textSpeed} min={0} max={200} step={5} unit="cps" onChange={(v) => upd((x) => { x.textSpeed = v; }, 'ts')} /></Field>
            <Field label={t('settings.autoDelay')}><NumberInput value={s.autoAdvanceDelay} min={0.2} step={0.1} unit="s" onChange={(v) => upd((x) => { x.autoAdvanceDelay = v; }, 'ad')} /></Field>
            <Field label={t('settings.defaultTransition')}>
              <div className="row-inline">
                <Select value={s.defaultTransition.type} options={session.engine.transitions.list().map((x) => ({ value: x.id, label: t(x.label) }))} onChange={(v) => upd((x) => { x.defaultTransition.type = v; })} />
                <NumberInput value={s.defaultTransition.duration} min={0} step={0.1} unit="s" onChange={(v) => upd((x) => { x.defaultTransition.duration = v; }, 'dtd')} />
              </div>
            </Field>
          </Section>
          <Section id="set.title" title={t('settings.titleScreen')}>
            <Field label={t('settings.titleBg')}><AssetPicker project={session.project} kind="image" value={s.titleScreen.backgroundAssetId || null} onChange={(v) => upd((x) => { x.titleScreen.backgroundAssetId = v; })} assetUrl={assetUrl} t={t} /></Field>
            <Field label={t('settings.titleMusic')}><AssetPicker project={session.project} kind="audio" value={s.titleScreen.musicAssetId || null} onChange={(v) => upd((x) => { x.titleScreen.musicAssetId = v; })} assetUrl={assetUrl} t={t} /></Field>
            <Toggle value={s.titleScreen.showTitle} onChange={(v) => upd((x) => { x.titleScreen.showTitle = v; })} label={t('settings.showTitle')} />
          </Section>
        </div>
        <div>
          <Section id="set.textbox" title={t('settings.textbox')}>
            <Field label={t('settings.position')}><Select value={tb.position} options={[{ value: 'bottom', label: t('settings.bottom') }, { value: 'top', label: t('settings.top') }, { value: 'center', label: t('settings.center') }]} onChange={(v) => upd((x) => { x.textbox.position = v as any; })} /></Field>
            <div className="field-pair">
              <Field label={t('settings.boxHeight')}><NumberInput value={tb.height} min={60} onChange={(v) => upd((x) => { x.textbox.height = v; }, 'tbh')} /></Field>
              <Field label={t('settings.fontSize')}><NumberInput value={tb.fontSize} min={10} onChange={(v) => upd((x) => { x.textbox.fontSize = v; }, 'tbf')} /></Field>
            </div>
            <div className="field-pair">
              <Field label={t('settings.margin')}><NumberInput value={tb.margin} min={0} onChange={(v) => upd((x) => { x.textbox.margin = v; }, 'tbm')} /></Field>
              <Field label={t('settings.radius')}><NumberInput value={tb.borderRadius} min={0} onChange={(v) => upd((x) => { x.textbox.borderRadius = v; }, 'tbr')} /></Field>
            </div>
            <Field label={t('settings.boxColor')}><ColorInput value={tb.background} onChange={(v, tr) => upd((x) => { x.textbox.background = v; }, tr ? 'tbbg' : undefined)} /></Field>
            <Field label={t('settings.textColor')}><ColorInput value={tb.textColor} onChange={(v, tr) => upd((x) => { x.textbox.textColor = v; }, tr ? 'tbtc' : undefined)} /></Field>
            <Field label={t('settings.nameColor')}><ColorInput value={tb.nameColor} onChange={(v, tr) => upd((x) => { x.textbox.nameColor = v; }, tr ? 'tbnc' : undefined)} /></Field>
            <Field label={t('settings.choiceColor')}><ColorInput value={tb.choiceBackground} onChange={(v, tr) => upd((x) => { x.textbox.choiceBackground = v; }, tr ? 'tbcb' : undefined)} /></Field>
            <Field label={t('settings.choiceHover')}><ColorInput value={tb.choiceHover} onChange={(v, tr) => upd((x) => { x.textbox.choiceHover = v; }, tr ? 'tbch' : undefined)} /></Field>
            <Field label={t('prop.font')}><FontPicker project={session.project} value={tb.fontFamily} onChange={(v) => upd((x) => { x.textbox.fontFamily = v || 'system-ui, sans-serif'; })} t={t} /></Field>
            <Toggle value={tb.showPortrait} onChange={(v) => upd((x) => { x.textbox.showPortrait = v; })} label={t('settings.showPortrait')} />
          </Section>
        </div>
      </div>
    </Modal>
  );
}
