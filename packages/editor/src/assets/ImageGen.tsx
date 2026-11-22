/**
 * Image generation: draft backgrounds and character sketches with an image service
 * (OpenAI-format, Stability AI or Replicate), then add the ones you like to the assets.
 */
import { useEffect, useState } from 'react';
import type { Asset, SceneData } from '@vne/core';
import { createLayer, hasSceneData } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store, useSession, useT } from '../state/store';
import { call } from '../host';
import { Modal } from '../ui/Modal';
import { Button, Field, Section, Select, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { ModelInput, UrlInput } from '../settings/SettingsWindow';

export type ImageProvider = 'openai' | 'stability' | 'replicate';
interface PubProvider { model: string; baseUrl: string; hasKey: boolean; keyHint: string }
export interface ImageConfig { provider: ImageProvider; openai: PubProvider; stability: PubProvider; replicate: PubProvider }
export type ImageKind = 'background' | 'character' | 'other';

const PROVIDERS: ImageProvider[] = ['openai', 'stability', 'replicate'];
const MODELS: Record<ImageProvider, string[]> = {
  openai: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
  stability: ['core', 'ultra', 'sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium'],
  replicate: ['black-forest-labs/flux-schnell', 'black-forest-labs/flux-dev', 'black-forest-labs/flux-1.1-pro', 'stability-ai/sdxl'],
};
const KEY_URLS: Record<ImageProvider, string> = {
  openai: 'https://platform.openai.com/api-keys',
  stability: 'https://platform.stability.ai/account/keys',
  replicate: 'https://replicate.com/account/api-tokens',
};

/** Extra prompt text per kind, so drafts fit where they go. */
const KIND_PROMPT: Record<ImageKind, string> = {
  background: 'Visual novel background, wide establishing shot, no people, no text, detailed environment art.',
  character: 'Visual novel character sprite sketch, full body, standing pose, facing the viewer, plain light background, no text.',
  other: '',
};

export function errorText(t: (k: string, v?: any) => string, e: any): string {
  const msg = String(e?.message || e).replace(/^Error:\s*/, '');
  if (/NO_KEY/.test(msg)) return t('imggen.noKey');
  if (/NO_MODEL/.test(msg)) return t('imggen.noModel');
  if (/TIMEOUT/.test(msg)) return t('imggen.timeout');
  return msg;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'image';
const extOf = (mediaType: string) => (/jpe?g/.test(mediaType) ? 'jpg' : /webp/.test(mediaType) ? 'webp' : 'png');

/** Generate images (the prompt gets the kind's extra text); sizes follow the stage for backgrounds. */
export async function generateImages(session: ProjectSession, args: { prompt: string; kind: ImageKind; negative?: string; count?: number; provider?: ImageProvider }) {
  const { width, height } = session.project.settings.resolution;
  const [w, h] = args.kind === 'background' ? [width, height] : args.kind === 'character' ? [832, 1216] : [1024, 1024];
  const prompt = [args.prompt.trim(), KIND_PROMPT[args.kind]].filter(Boolean).join('\n');
  return call<{ images: { data: string; mediaType: string }[]; provider: string; model: string }>('images.generate', { prompt, negative: args.negative, width: w, height: h, count: args.count ?? 1, provider: args.provider });
}

/** Add a generated image to the project's assets (one history step). */
export async function addGeneratedImage(session: ProjectSession, img: { data: string; mediaType: string }, name: string): Promise<Asset | null> {
  const r = await call('assets.import', { path: session.path, files: [{ name: `${slug(name)}.${extOf(img.mediaType)}`, dataBase64: img.data }], existing: session.project.assets });
  if (r.errors?.length) throw new Error(r.errors.join('\n'));
  if (r.assets.length) session.update(session.i18n.t('imggen.history'), (d) => { d.assets.push(...r.assets); });
  return r.assets[0] || session.project.assets.find((a) => r.reused.includes(a.id)) || null;
}

/** Put an image asset behind a scene (replacing the image of its own background element, if any). */
export function useAsBackground(session: ProjectSession, nodeId: string, asset: Asset): void {
  session.update(session.i18n.t('imggen.useAsBackground'), (d) => {
    const n = d.nodes[nodeId];
    if (!n || !hasSceneData(n)) return;
    const s = n.data as SceneData;
    const bg = s.layers.find((l) => l.type === 'core.background');
    if (bg) bg.props.assetId = asset.id;
    else s.layers.unshift(createLayer(session.engine, d, 'core.background', asset.name, { assetId: asset.id }));
  });
}

export function GenerateImageDialog({ session, kind: initialKind, onClose }: { session: ProjectSession; kind?: ImageKind; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const [cfg, setCfg] = useState<ImageConfig | null>(null);
  const [kind, setKind] = useState<ImageKind>(initialKind || 'background');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [count, setCount] = useState(2);
  const [provider, setProvider] = useState<ImageProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ data: string; mediaType: string; added?: Asset }[]>([]);
  useEffect(() => { call<ImageConfig>('images.config').then((c) => { setCfg(c); setProvider(c.provider); }).catch(() => {}); }, []);
  const node = session.currentNodeId ? session.project.nodes[session.currentNodeId] : null;
  const scene = node && hasSceneData(node) ? node : null;
  const p = provider && cfg ? cfg[provider] : null;
  const ready = !!p && (p.hasKey || /localhost|127\.0\.0\.1/.test(p.baseUrl));

  const run = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const r = await generateImages(session, { prompt, kind, negative: negative.trim() || undefined, count, provider: provider || undefined });
      setResults((x) => [...r.images, ...x].slice(0, 12));
    } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  };
  const add = async (i: number, background = false) => {
    try {
      const a = results[i].added || await addGeneratedImage(session, results[i], `${kind}-${prompt}`);
      if (!a) return;
      setResults((x) => x.map((r, k) => (k === i ? { ...r, added: a } : r)));
      if (background && scene) { useAsBackground(session, scene.id, a); store.toast(t('imggen.usedAsBackground', { name: scene.name }), 'success'); }
      else store.toast(t('imggen.added', { name: a.name }), 'success');
    } catch (e) { store.toast(errorText(t, e), 'error'); }
  };

  return (
    <Modal title={t('imggen.title')} onClose={onClose} width={920} icon={<Icon name="imagePlus" size={18} />} className="imggen-modal"
      footer={<><span className="muted small">{t('imggen.footer')}</span><span className="grow" /><Button onClick={onClose}>{t('common.close')}</Button></>}>
      <div className="imggen">
        <div className="imggen-form">
          <div className="seg">
            {(['background', 'character', 'other'] as ImageKind[]).map((k) => <button key={k} type="button" className={cx('seg-btn', kind === k && 'active')} onClick={() => setKind(k)}><Icon name={k === 'background' ? 'image' : k === 'character' ? 'user' : 'sparkles'} size={13} />{t(`imggen.kind.${k}`)}</button>)}
          </div>
          <textarea className="input imggen-prompt" rows={5} value={prompt} placeholder={t(`imggen.placeholder.${kind}`)} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }} />
          <input className="input" value={negative} placeholder={t('imggen.negative')} onChange={(e) => setNegative(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {cfg && <Select title={t('imggen.service')} value={provider || cfg.provider} options={PROVIDERS.map((x) => ({ value: x, label: `${t(`imggen.provider.${x}`)} · ${cfg[x].model}${cfg[x].hasKey || /localhost|127\.0\.0\.1/.test(cfg[x].baseUrl) ? '' : ` (${t('imggen.noKeyShort')})`}` }))} onChange={(v) => setProvider(v as ImageProvider)} />}
          <div className="imggen-row">
            <Select className="imggen-count" value={count} options={[1, 2, 3, 4].map((n) => ({ value: n, label: t('imggen.count', { n }) }))} onChange={(v) => setCount(Number(v))} />
            <span className="grow" />
            <Button kind="primary" icon={busy ? 'refresh' : 'sparkles'} disabled={!prompt.trim() || busy || !ready} onClick={run}>{busy ? t('imggen.generating') : t('imggen.generate')}</Button>
          </div>
          {cfg && !ready && <div className="imggen-note"><Icon name="key" size={13} />{t('imggen.needKey', { name: t(`imggen.provider.${provider}`) })} <button type="button" className="link" onClick={() => store.open({ kind: 'settings', tab: 'images' })}>{t('ai.openSettings')}</button></div>}
          {error && <div className="imggen-note err"><Icon name="warning" size={13} />{error}</div>}
          <p className="muted small">{t('imggen.costNote')}</p>
        </div>
        <div className={cx('imggen-results', !results.length && 'empty')}>
          {busy && <div className="imggen-busy"><span /><span /><span /></div>}
          {!results.length && !busy && <div className="muted">{t('imggen.resultsEmpty')}</div>}
          {results.map((r, i) => (
            <figure key={i} className={cx('imggen-card', r.added && 'added')}>
              <img src={`data:${r.mediaType};base64,${r.data}`} alt="" />
              <figcaption>
                {r.added ? <span className="ok-text"><Icon name="check" size={12} />{t('imggen.inAssets')}</span> : <Button small icon="plus" onClick={() => add(i)}>{t('imggen.add')}</Button>}
                {kind === 'background' && scene && <Button small kind="ghost" icon="image" onClick={() => add(i, true)} title={t('imggen.useInScene', { name: scene.name })}>{t('imggen.useAsBackground')}</Button>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Settings → Image generation. */
export function ImagePrefs() {
  const t = useT();
  const [cfg, setCfg] = useState<ImageConfig | null>(null);
  const [key, setKey] = useState('');
  useEffect(() => { call<ImageConfig>('images.config').then(setCfg).catch(() => {}); }, []);
  if (!cfg) return <p className="muted">{t('common.loading')}</p>;
  const save = async (patch: any) => {
    try { setCfg(await call('images.configure', { patch })); }
    catch (e: any) { store.toast(`${t('ai.saveFailed')}: ${e?.message || e}`, 'error'); }
  };
  const prov = cfg.provider;
  const cur = cfg[prov];
  const saveKey = async () => { if (!key.trim()) return; await save({ [prov]: { key: key.trim() } }); setKey(''); store.toast(t('ai.keySaved'), 'success'); };
  return (
    <Section id="prefs.images" title={t('imggen.service')}>
      <div className="provider-cards three">
        {PROVIDERS.map((id) => (
          <button key={id} type="button" className={cx('provider-card', prov === id && 'active')} onClick={() => save({ provider: id })}>
            <Icon name={id === 'openai' ? 'plug' : id === 'stability' ? 'palette' : 'module'} size={18} />
            <span className="provider-name">{t(`imggen.provider.${id}`)}</span>
            <span className="muted small">{t(`imggen.provider.${id}.hint`)}</span>
            {cfg[id].hasKey && <span className="provider-key"><Icon name="key" size={11} />{cfg[id].keyHint}</span>}
          </button>
        ))}
      </div>
      <Field label={t('ai.apiKey')} hint={cur.hasKey ? t('ai.keyStored', { hint: cur.keyHint }) : t('imggen.keyHint', { url: KEY_URLS[prov] })}>
        <div className="row-inline">
          <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder={cur.hasKey ? `•••••••• ${cur.keyHint}` : prov === 'replicate' ? 'r8_…' : 'sk-…'} value={key}
            onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveKey(); }} />
          <Button onClick={saveKey} disabled={!key.trim()}>{t('ai.saveKey')}</Button>
          {cur.hasKey && <Button kind="ghost" icon="trash" onClick={() => save({ [prov]: { clearKey: true } })} title={t('ai.removeKey')} />}
        </div>
      </Field>
      <Field label={t('ai.model')} hint={t(`imggen.modelHint.${prov}`)}>
        <ModelInput value={cur.model} models={MODELS[prov]} onChange={(v) => save({ [prov]: { model: v } })} />
      </Field>
      <details className="settings-advanced" open={prov === 'openai' && !/api\.openai\.com/.test(cur.baseUrl)}>
        <summary>{t('ai.advanced')}</summary>
        <Field label={t('ai.baseUrl')} hint={t(`imggen.baseUrlHint.${prov}`)}>
          <UrlInput value={cur.baseUrl} onChange={(v) => save({ [prov]: { baseUrl: v } })} />
        </Field>
      </details>
      <p className="muted small">{t('imggen.privacy')}</p>
    </Section>
  );
}
