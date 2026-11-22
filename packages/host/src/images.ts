/**
 * Image generation for backgrounds and character sketches. Three kinds of service:
 *  - OpenAI-format  POST {base}/images/generations (OpenAI, and proxies that offer other models,
 *    e.g. Midjourney, through the same format)
 *  - Stability AI   POST {base}/v2beta/stable-image/generate/{core|ultra|sd3}
 *  - Replicate      POST {base}/models/{owner}/{name}/predictions (or a version id)
 * Keys are stored like the AI assistant's: per service address, encrypted where the system allows.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { AiSecrets } from './ai';
import { originOf } from './ai';

export type ImageProvider = 'openai' | 'stability' | 'replicate';
export interface ImageProviderSettings { model: string; baseUrl: string; keys?: Record<string, string> }
export interface ImageConfig { provider: ImageProvider; openai: ImageProviderSettings; stability: ImageProviderSettings; replicate: ImageProviderSettings }

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  provider: 'openai',
  openai: { model: 'gpt-image-1', baseUrl: 'https://api.openai.com/v1' },
  stability: { model: 'core', baseUrl: 'https://api.stability.ai' },
  replicate: { model: 'black-forest-labs/flux-schnell', baseUrl: 'https://api.replicate.com/v1' },
};
const PROVIDERS: ImageProvider[] = ['openai', 'stability', 'replicate'];

export interface GenerateArgs { prompt: string; negative?: string; width?: number; height?: number; count?: number; provider?: ImageProvider }
export interface GeneratedImage { data: string; mediaType: string }

const keyOf = (p: ImageProviderSettings) => p.keys?.[originOf(p.baseUrl)];
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url || '');

export function publicImageConfig(c: ImageConfig) {
  const pub = (p: ImageProviderSettings) => { const k = keyOf(p); return { model: p.model, baseUrl: p.baseUrl, hasKey: !!k, keyHint: k ? `…${k.slice(-4)}` : '' }; };
  return { provider: c.provider, openai: pub(c.openai), stability: pub(c.stability), replicate: pub(c.replicate) };
}

/** Closest aspect ratio Stability and Replicate accept. */
export function aspectRatio(w: number, h: number): string {
  const options = ['1:1', '16:9', '9:16', '21:9', '9:21', '3:2', '2:3', '4:5', '5:4'];
  const r = w / h;
  let best = '1:1', d = Infinity;
  for (const o of options) { const [a, b] = o.split(':').map(Number); const e = Math.abs(Math.log(r / (a / b))); if (e < d) { d = e; best = o; } }
  return best;
}

/** OpenAI image sizes: 1024 square, or the landscape / portrait size the model offers. */
export function openaiSize(model: string, w: number, h: number): string {
  const r = w / h;
  if (/dall-e-2/.test(model)) return '1024x1024';
  if (/dall-e-3/.test(model)) return r > 1.2 ? '1792x1024' : r < 0.83 ? '1024x1792' : '1024x1024';
  return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024';
}

export class ImageService {
  private config: ImageConfig | null = null;
  constructor(private file: string, private secrets?: AiSecrets, private fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  async load(): Promise<ImageConfig> {
    if (this.config) return this.config;
    const c: ImageConfig = JSON.parse(JSON.stringify(DEFAULT_IMAGE_CONFIG));
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      const dec = (v: any) => {
        if (typeof v !== 'string' || !v) return undefined;
        if (v.startsWith('enc:') && this.secrets) { try { return this.secrets.decrypt(v.slice(4)); } catch { return undefined; } }
        return v.startsWith('enc:') ? undefined : v;
      };
      if (PROVIDERS.includes(raw.provider)) c.provider = raw.provider;
      for (const p of PROVIDERS) {
        Object.assign(c[p], pick(raw[p]));
        const keys: Record<string, string> = {};
        for (const [o, v] of Object.entries(raw[p]?.keys || {})) { const k = dec(v); if (k) keys[o] = k; }
        c[p].keys = keys;
      }
    } catch { /* first run */ }
    this.config = c;
    return c;
  }

  private async save(): Promise<void> {
    const c = this.config!;
    const enc = (k: string) => { if (this.secrets) { try { return `enc:${this.secrets.encrypt(k)}`; } catch { /* plain, user-only file */ } } return k; };
    const out: any = { provider: c.provider };
    for (const p of PROVIDERS) out[p] = { model: c[p].model, baseUrl: c[p].baseUrl, keys: Object.fromEntries(Object.entries(c[p].keys || {}).map(([o, k]) => [o, enc(k)])) };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(`${this.file}.tmp`, JSON.stringify(out, null, 2), { mode: 0o600 });
    await fsp.rename(`${this.file}.tmp`, this.file);
  }

  async getPublic() { return publicImageConfig(await this.load()); }

  async update(patch: any) {
    const c = await this.load();
    if (PROVIDERS.includes(patch?.provider)) c.provider = patch.provider;
    for (const p of PROVIDERS) {
      const src = patch?.[p];
      if (!src || typeof src !== 'object') continue;
      Object.assign(c[p], pick(src));
      const origin = originOf(c[p].baseUrl);
      if (typeof src.key === 'string' && src.key.trim()) c[p].keys = { ...(c[p].keys || {}), [origin]: src.key.trim() };
      if (src.clearKey && c[p].keys) { const k = { ...c[p].keys }; delete k[origin]; c[p].keys = k; }
    }
    await this.save();
    return publicImageConfig(c);
  }

  async generate(args: GenerateArgs): Promise<{ images: GeneratedImage[]; provider: ImageProvider; model: string }> {
    const c = await this.load();
    const provider = args.provider && PROVIDERS.includes(args.provider) ? args.provider : c.provider;
    const s = c[provider];
    const key = keyOf(s);
    if (!key && !isLocal(s.baseUrl)) throw new Error('NO_KEY');
    if (!s.model) throw new Error('NO_MODEL');
    const prompt = String(args.prompt || '').trim();
    if (!prompt) throw new Error('NO_PROMPT');
    const w = Math.max(64, Number(args.width) || 1024), h = Math.max(64, Number(args.height) || 1024);
    const count = Math.max(1, Math.min(4, Math.round(Number(args.count) || 1)));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 300_000);
    try {
      const images = provider === 'openai' ? await this.openai(s, key, prompt, args.negative, w, h, count, ctl.signal)
        : provider === 'stability' ? await this.stability(s, key!, prompt, args.negative, w, h, count, ctl.signal)
        : await this.replicate(s, key!, prompt, args.negative, w, h, count, ctl.signal);
      if (!images.length) throw new Error('The service returned no image.');
      return { images, provider, model: s.model };
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('TIMEOUT');
      throw e;
    } finally { clearTimeout(timer); }
  }

  private async download(url: string, signal: AbortSignal): Promise<GeneratedImage> {
    if (url.startsWith('data:')) { const m = /^data:([^;]+);base64,(.*)$/.exec(url); if (m) return { mediaType: m[1], data: m[2] }; }
    const r = await this.fetchImpl(url, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} downloading the image`);
    return { mediaType: r.headers.get('content-type')?.split(';')[0] || 'image/png', data: Buffer.from(await r.arrayBuffer()).toString('base64') };
  }

  private async openai(s: ImageProviderSettings, key: string | undefined, prompt: string, negative: string | undefined, w: number, h: number, n: number, signal: AbortSignal) {
    const full = negative ? `${prompt}\nAvoid: ${negative}` : prompt;
    const body: any = { model: s.model, prompt: full, size: openaiSize(s.model, w, h), n: /dall-e-3/.test(s.model) ? 1 : n };
    if (/dall-e/.test(s.model)) body.response_format = 'b64_json';
    const res = await this.fetchImpl(`${s.baseUrl}/images/generations`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readError(res)}`);
    const j: any = await res.json();
    const out: GeneratedImage[] = [];
    for (const d of j.data || []) {
      if (d.b64_json) out.push({ data: d.b64_json, mediaType: d.mime_type || 'image/png' });
      else if (d.url) out.push(await this.download(d.url, signal));
    }
    return out;
  }

  private async stability(s: ImageProviderSettings, key: string, prompt: string, negative: string | undefined, w: number, h: number, n: number, signal: AbortSignal) {
    const model = s.model.replace(/^stable-image-?/, '') || 'core';
    const endpoint = /^sd3/.test(model) ? 'sd3' : model === 'ultra' ? 'ultra' : 'core';
    const out: GeneratedImage[] = [];
    for (let i = 0; i < n; i++) {
      const form = new FormData();
      form.append('prompt', prompt);
      if (negative) form.append('negative_prompt', negative);
      form.append('aspect_ratio', aspectRatio(w, h));
      form.append('output_format', 'png');
      if (endpoint === 'sd3' && model !== 'sd3') form.append('model', model);
      const res = await this.fetchImpl(`${s.baseUrl}/v2beta/stable-image/generate/${endpoint}`, { method: 'POST', signal, headers: { authorization: `Bearer ${key}`, accept: 'image/*' }, body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readError(res)}`);
      out.push({ mediaType: res.headers.get('content-type')?.split(';')[0] || 'image/png', data: Buffer.from(await res.arrayBuffer()).toString('base64') });
    }
    return out;
  }

  private async replicate(s: ImageProviderSettings, key: string, prompt: string, negative: string | undefined, w: number, h: number, n: number, signal: AbortSignal) {
    // "owner/name" runs the model's latest version; a bare version id runs that version.
    const byModel = s.model.includes('/') && !s.model.includes(':');
    const url = byModel ? `${s.baseUrl}/models/${s.model}/predictions` : `${s.baseUrl}/predictions`;
    const input: any = { prompt, aspect_ratio: aspectRatio(w, h), num_outputs: n, output_format: 'png' };
    if (negative) input.negative_prompt = negative;
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}`, prefer: 'wait' };
    const res = await this.fetchImpl(url, { method: 'POST', signal, headers, body: JSON.stringify(byModel ? { input } : { version: s.model.split(':').pop(), input }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readError(res)}`);
    let p: any = await res.json();
    // "Prefer: wait" usually returns the finished prediction; otherwise poll until it is done.
    for (let i = 0; i < 150 && p && !['succeeded', 'failed', 'canceled'].includes(p.status); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await this.fetchImpl(p.urls?.get || `${s.baseUrl}/predictions/${p.id}`, { signal, headers: { authorization: `Bearer ${key}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await readError(r)}`);
      p = await r.json();
    }
    if (p.status !== 'succeeded') throw new Error(p.error ? String(p.error) : `Prediction ${p.status || 'did not finish'}`);
    const urls: string[] = (Array.isArray(p.output) ? p.output : [p.output]).filter((x: any) => typeof x === 'string');
    const out: GeneratedImage[] = [];
    for (const u of urls.slice(0, n)) out.push(await this.download(u, signal));
    return out;
  }
}

function pick(src: any): Partial<ImageProviderSettings> {
  const out: Partial<ImageProviderSettings> = {};
  if (typeof src?.model === 'string') out.model = src.model.trim();
  if (typeof src?.baseUrl === 'string') out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
  return out;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    const e = j?.error?.message || j?.message || j?.detail || j?.errors?.join?.('; ') || j?.error || j?.name;
    return typeof e === 'string' ? e : text.slice(0, 300);
  } catch { return text.slice(0, 300) || res.statusText; }
}
