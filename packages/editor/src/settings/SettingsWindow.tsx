/**
 * Settings window: editor preferences (this computer) and the open project's settings.
 * Sections: General, Appearance, Editing, AI assistant (model API + editor tools), Project.
 */
import { useEffect, useState } from 'react';
import type { ProjectSession } from '../state/session';
import { store, useStore, useT } from '../state/store';
import { ACCENTS, DEFAULT_PREFS, THEMES, ThemeName, resetPrefs, setPrefs, usePrefs } from '../state/prefs';
import { Modal } from '../ui/Modal';
import { Button, ColorInput, Field, NumberInput, Section, Select, Toggle, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { ProjectSettingsBody } from './ProjectSettings';
import { call } from '../host';
import { loadAiConfig } from '../ai/ChatPanel';
import type { AiPublicConfig } from '../ai/agent';
import { TOOL_NAMES } from '../ai/tools';

type Tab = 'general' | 'appearance' | 'editing' | 'ai' | 'project';

const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'bounce', 'elastic', 'step'];
const EASE_LABEL: Record<string, string> = { easeIn: 'ease.in', easeOut: 'ease.out', easeInOut: 'ease.inOut' };

/** OpenAI-compatible services: base URL and a starting model (the user can type any model). */
export const OPENAI_PRESETS: { id: string; label: string; baseUrl: string; model: string; models: string[]; keyUrl?: string }[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'moonshot', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { id: 'qwen', label: '通义千问 Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', models: [] },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', models: ['qwen2.5', 'llama3.1'] },
  { id: 'custom', label: 'Custom', baseUrl: '', model: '', models: [] },
];
const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

export function SettingsWindow({ session, tab: initial, onClose }: { session: ProjectSession | null; tab?: string; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>((initial as Tab) || (session ? 'project' : 'appearance'));
  const nav: { id: Tab; icon: string; label: string }[] = [
    ...(session ? [{ id: 'project' as Tab, icon: 'book', label: t('prefs.tab.project') }] : []),
    { id: 'general', icon: 'globe', label: t('prefs.tab.general') },
    { id: 'appearance', icon: 'palette', label: t('prefs.tab.appearance') },
    { id: 'editing', icon: 'sliders', label: t('prefs.tab.editing') },
    { id: 'ai', icon: 'bot', label: t('prefs.tab.ai') },
  ];
  return (
    <Modal title={t('prefs.title')} onClose={onClose} width={920} icon={<Icon name="settings" size={18} />} className="settings-modal" footer={<Button kind="primary" onClick={onClose}>{t('common.done')}</Button>}>
      <div className="settings-layout">
        <nav className="settings-nav">
          {nav.map((n) => (
            <button key={n.id} type="button" className={cx('settings-nav-item', tab === n.id && 'active')} onClick={() => setTab(n.id)}>
              <Icon name={n.icon} size={15} />{n.label}
            </button>
          ))}
          <div className="grow" />
          <p className="muted small settings-note">{t('prefs.localNote')}</p>
        </nav>
        <div className="settings-body">
          {tab === 'project' && session && <ProjectSettingsBody session={session} />}
          {tab === 'general' && <GeneralPrefs />}
          {tab === 'appearance' && <AppearancePrefs />}
          {tab === 'editing' && <EditingPrefs />}
          {tab === 'ai' && <AiPrefs />}
        </div>
      </div>
    </Modal>
  );
}

function GeneralPrefs() {
  const t = useT();
  const st = useStore();
  const p = usePrefs();
  return (
    <>
      <Section id="prefs.language" title={t('prefs.language')}>
        <Field label={t('prefs.interfaceLanguage')} hint={t('prefs.languageHint')}>
          <Select value={st.i18n.locale} options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} onChange={(v) => st.setLocale(v)} />
        </Field>
      </Section>
      <Section id="prefs.saving" title={t('prefs.saving')}>
        <Toggle value={p.autoSave} onChange={(v) => setPrefs({ autoSave: v })} label={t('prefs.autoSave')} />
        {p.autoSave && <Field label={t('prefs.autoSaveAfter')}><NumberInput value={p.autoSaveSeconds} min={10} max={1800} step={10} unit="s" onChange={(v) => setPrefs({ autoSaveSeconds: Math.round(v) })} /></Field>}
        <p className="muted small">{t('prefs.recoveryNote')}</p>
        <Field label={t('prefs.undoLimit')} hint={t('prefs.undoLimitHint')}><NumberInput value={p.undoLimit} min={20} max={2000} step={10} onChange={(v) => setPrefs({ undoLimit: Math.round(v) })} /></Field>
      </Section>
      <Section id="prefs.reset" title={t('prefs.resetTitle')}>
        <Button icon="refresh" onClick={async () => { if (await store.confirm(t('prefs.resetTitle'), t('prefs.resetText'), t('prefs.reset'))) resetPrefs(); }}>{t('prefs.reset')}</Button>
      </Section>
    </>
  );
}

function AppearancePrefs() {
  const t = useT();
  const p = usePrefs();
  const fonts = [
    { value: '', label: t('prefs.font.system') },
    { value: '"Inter"', label: 'Inter' },
    { value: '"PingFang SC"', label: 'PingFang SC / 苹方' },
    { value: '"Microsoft YaHei"', label: 'Microsoft YaHei / 微软雅黑' },
    { value: '"Noto Sans SC"', label: 'Noto Sans SC / 思源黑体' },
    { value: 'Georgia, serif', label: 'Georgia (serif)' },
  ];
  return (
    <>
      <Section id="prefs.theme" title={t('prefs.theme')}>
        <div className="theme-grid">
          {(Object.keys(THEMES) as ThemeName[]).map((k) => (
            <button key={k} type="button" className={cx('theme-card', p.theme === k && !p.background && 'active')} onClick={() => setPrefs({ theme: k, background: null })}>
              <span className="theme-swatch" style={{ background: THEMES[k].bg }}><span style={{ background: p.accent }} /></span>
              {t(THEMES[k].label)}
            </button>
          ))}
        </div>
        <Field label={t('prefs.background')} hint={t('prefs.backgroundHint')} actions={p.background ? <button type="button" className="link small" onClick={() => setPrefs({ background: null })}>{t('prefs.useTheme')}</button> : undefined}>
          <ColorInput value={p.background || THEMES[p.theme].bg} onChange={(v) => setPrefs({ background: v })} />
        </Field>
        <Field label={t('prefs.accent')}>
          <div className="accent-row">
            {ACCENTS.map((c) => <button key={c} type="button" className={cx('accent-dot', p.accent === c && 'active')} style={{ background: c }} onClick={() => setPrefs({ accent: c })} aria-label={c} />)}
            <ColorInput value={p.accent} onChange={(v) => setPrefs({ accent: v })} />
          </div>
        </Field>
      </Section>
      <Section id="prefs.text" title={t('prefs.textAndSize')}>
        <Field label={t('prefs.fontScale')} hint={t('prefs.fontScaleHint')}>
          <div className="range-row">
            <input type="range" min={0.85} max={1.3} step={0.05} value={p.fontScale} onChange={(e) => setPrefs({ fontScale: Number(e.target.value) })} />
            <span className="range-val">{Math.round(p.fontScale * 13)} px</span>
          </div>
        </Field>
        <Field label={t('prefs.zoom')} hint={t('prefs.zoomHint')}>
          <div className="range-row">
            <input type="range" min={0.8} max={1.5} step={0.05} value={p.zoom} onChange={(e) => setPrefs({ zoom: Number(e.target.value) })} />
            <span className="range-val">{Math.round(p.zoom * 100)}%</span>
          </div>
        </Field>
        <Field label={t('prefs.uiFont')}><Select value={p.uiFont} options={fonts} onChange={(v) => setPrefs({ uiFont: v })} /></Field>
      </Section>
      <Section id="prefs.canvas" title={t('prefs.canvas')}>
        <Field label={t('prefs.canvasBackdrop')}>
          <Select value={p.canvasBackdrop} options={(['checker', 'dark', 'light', 'custom'] as const).map((v) => ({ value: v, label: t(`prefs.backdrop.${v}`) }))} onChange={(v) => setPrefs({ canvasBackdrop: v as any })} />
        </Field>
        {p.canvasBackdrop === 'custom' && <Field label={t('prefs.canvasColor')}><ColorInput value={p.canvasColor} onChange={(v) => setPrefs({ canvasColor: v })} /></Field>}
        <Toggle value={p.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} label={t('prefs.reduceMotion')} />
      </Section>
    </>
  );
}

function EditingPrefs() {
  const t = useT();
  const p = usePrefs();
  return (
    <>
      <Section id="prefs.keys" title={t('prefs.animation')}>
        <Field label={t('prefs.defaultEase')} hint={t('prefs.defaultEaseHint')}>
          <Select value={p.defaultEase} options={EASES.map((e) => ({ value: e, label: t(EASE_LABEL[e] || `ease.${e}`) }))} onChange={(v) => setPrefs({ defaultEase: v })} />
        </Field>
        <Field label={t('prefs.timeDisplay')}>
          <Select value={p.timeDisplay} options={[{ value: 'seconds', label: t('prefs.time.seconds') }, { value: 'frames', label: t('prefs.time.frames') }]} onChange={(v) => setPrefs({ timeDisplay: v as any })} />
        </Field>
        <Field label={t('prefs.fps')} hint={t('prefs.fpsHint')}>
          <Select value={String(p.fps)} options={['12', '24', '25', '30', '48', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))} onChange={(v) => setPrefs({ fps: Number(v) })} />
        </Field>
      </Section>
      <Section id="prefs.canvasEdit" title={t('prefs.canvasEditing')}>
        <Toggle value={p.snap} onChange={(v) => setPrefs({ snap: v })} label={t('prefs.snapDefault')} />
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* AI assistant                                                         */
/* ------------------------------------------------------------------ */

function AiPrefs() {
  const t = useT();
  const p = usePrefs();
  const [cfg, setCfg] = useState<AiPublicConfig | null>(null);
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text?: string }>({ state: 'idle' });
  const [showTools, setShowTools] = useState(false);
  useEffect(() => { loadAiConfig(true).then(setCfg); }, []);
  if (!cfg) return <p className="muted">{t('common.loading')}</p>;

  const save = async (patch: any) => {
    try { const next = await call('ai.configure', { patch }); setCfg(next); await loadAiConfig(true); }
    catch (e: any) { store.toast(`${t('ai.saveFailed')}: ${e?.message || e}`, 'error'); }
  };
  const prov = cfg.provider;
  const cur = cfg[prov];
  const preset = prov === 'openai' ? OPENAI_PRESETS.find((x) => x.id === cfg.openai.preset) || OPENAI_PRESETS[OPENAI_PRESETS.length - 1] : null;
  const models = prov === 'anthropic' ? CLAUDE_MODELS : preset?.models || [];
  const saveKey = async () => { if (!key.trim()) return; await save({ [prov]: { key: key.trim() } }); setKey(''); store.toast(t('ai.keySaved'), 'success'); };
  const runTest = async () => {
    setTest({ state: 'running' });
    try {
      const r = await call('ai.chat', { system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 256 });
      const text = (r?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim();
      setTest({ state: 'ok', text: `${r?.model || cur.model}: ${text.slice(0, 80) || '(empty reply)'}` });
    } catch (e: any) {
      const msg = String(e?.message || e);
      setTest({ state: 'error', text: /NO_KEY/.test(msg) ? t('ai.noKey') : /NO_MODEL/.test(msg) ? t('ai.noModel') : msg });
    }
  };

  return (
    <>
      <Section id="prefs.ai.provider" title={t('ai.provider')}>
        <div className="provider-cards">
          {(['anthropic', 'openai'] as const).map((id) => (
            <button key={id} type="button" className={cx('provider-card', prov === id && 'active')} onClick={() => save({ provider: id })}>
              <Icon name={id === 'anthropic' ? 'sparkle' : 'plug'} size={18} />
              <span className="provider-name">{t(`ai.provider.${id}`)}</span>
              <span className="muted small">{t(`ai.provider.${id}.hint`)}</span>
              {cfg[id].hasKey && <span className="provider-key"><Icon name="key" size={11} />{cfg[id].keyHint}</span>}
            </button>
          ))}
        </div>
        {prov === 'openai' && (
          <Field label={t('ai.service')}>
            <Select value={preset!.id} options={OPENAI_PRESETS.map((x) => ({ value: x.id, label: x.id === 'custom' ? t('ai.customService') : x.label }))}
              onChange={(v) => { const x = OPENAI_PRESETS.find((y) => y.id === v)!; save({ openai: { preset: x.id, ...(x.id !== 'custom' ? { baseUrl: x.baseUrl, model: x.model } : {}) } }); }} />
          </Field>
        )}
        <Field label={t('ai.apiKey')} hint={cur.hasKey ? t('ai.keyStored', { hint: cur.keyHint }) : prov === 'openai' && /localhost|127\.0\.0\.1/.test(cur.baseUrl) ? t('ai.keyOptionalLocal') : t('ai.keyHint')}>
          <div className="row-inline">
            <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder={cur.hasKey ? `•••••••• ${cur.keyHint}` : prov === 'anthropic' ? 'sk-ant-…' : 'sk-…'} value={key}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveKey(); }} />
            <Button onClick={saveKey} disabled={!key.trim()}>{t('ai.saveKey')}</Button>
            {cur.hasKey && <Button kind="ghost" icon="trash" onClick={() => save({ [prov]: { clearKey: true } })} title={t('ai.removeKey')} />}
          </div>
        </Field>
        <Field label={t('ai.model')} hint={t('ai.modelHint')}>
          <ModelInput value={cur.model} models={models} onChange={(v) => save({ [prov]: { model: v } })} />
        </Field>
        <details className="settings-advanced">
          <summary>{t('ai.advanced')}</summary>
          <Field label={t('ai.baseUrl')} hint={prov === 'anthropic' ? t('ai.baseUrlHintClaude') : t('ai.baseUrlHint')}>
            <UrlInput value={cur.baseUrl} onChange={(v) => save({ [prov]: { baseUrl: v }, ...(prov === 'openai' ? { openai: { baseUrl: v, preset: 'custom' } } : {}) })} />
          </Field>
          <Field label={t('ai.maxTokens')} hint={t('ai.maxTokensHint')}><NumberInput value={cfg.maxTokens} min={256} max={64000} step={256} onChange={(v) => save({ maxTokens: v })} /></Field>
        </details>
        <div className="row-inline ai-test-row">
          <Button icon={test.state === 'running' ? 'refresh' : 'plug'} onClick={runTest} disabled={test.state === 'running'}>{t('ai.test')}</Button>
          {test.state === 'ok' && <span className="ok-text"><Icon name="check" size={13} />{t('ai.testOk')} <span className="muted">{test.text}</span></span>}
          {test.state === 'error' && <span className="err-text"><Icon name="warning" size={13} />{test.text}</span>}
        </div>
        <p className="muted small">{t('ai.privacy')}</p>
      </Section>
      <Section id="prefs.ai.mcp" title={t('ai.mcpTitle')} tip={t('ai.mcpTip')}>
        <Field label={t('ai.permissions')}>
          <Select value={p.aiMode} options={[{ value: 'edit', label: t('ai.mode.editLong') }, { value: 'read', label: t('ai.mode.readLong') }]} onChange={(v) => setPrefs({ aiMode: v as any })} />
        </Field>
        <p className="muted small">{t('ai.mcpText', { n: TOOL_NAMES.length })}</p>
        <button type="button" className="link small" onClick={() => setShowTools(!showTools)}>{showTools ? t('ai.hideTools') : t('ai.showTools')}</button>
        {showTools && (
          <ul className="tool-list">
            {TOOL_NAMES.map((x) => (
              <li key={x.name} className={cx(x.readOnly && 'ro')}>
                <code>{x.name}</code><span>{t(`ai.tool.${x.name}`)}</span>{x.readOnly && <span className="tool-ro">{t('ai.readOnlyTool')}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ModelInput({ value, models, onChange }: { value: string; models: string[]; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const id = 'ai-models';
  return (
    <>
      <input className="input" list={id} value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() && draft !== value && onChange(draft.trim())} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <datalist id={id}>{models.map((m) => <option key={m} value={m} />)}</datalist>
    </>
  );
}

function UrlInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="input" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onChange(draft.trim())} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

void DEFAULT_PREFS;
