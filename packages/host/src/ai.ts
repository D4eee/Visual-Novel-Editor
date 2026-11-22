/**
 * The AI assistant's connection to a language model, run by the host so API keys never
 * reach the editor page and requests are not limited by browser CORS rules.
 *
 * Two kinds of provider:
 * - `anthropic`: the Claude Messages API.
 * - `openai`: any OpenAI-compatible Chat Completions API (OpenAI, DeepSeek, Kimi, Qwen,
 *   Ollama and others; set its base URL).
 *
 * The editor speaks one message format (Anthropic-style content blocks) and describes its
 * tools the way MCP does (`name`, `description`, `inputSchema`); this file converts both
 * to and from each provider's format.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export type AiProvider = 'anthropic' | 'openai';

/** A picture for vision models (Anthropic's block shape; converted for OpenAI-compatible services). */
export type AiImage = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
export type AiBlock =
  | { type: 'text'; text: string }
  | AiImage
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string | ({ type: 'text'; text: string } | AiImage)[]; is_error?: boolean };

const dataUrl = (b: AiImage) => `data:${b.source.media_type};base64,${b.source.data}`;

export interface AiMessage { role: 'user' | 'assistant'; content: string | AiBlock[] }
export interface AiTool { name: string; description: string; inputSchema: any }

export interface AiProviderSettings {
  model: string;
  baseUrl: string;
  /** API keys by service address (origin of the base URL): a key is only ever sent to the service it was saved for. */
  keys?: Record<string, string>;
}
export const originOf = (url: string) => { try { return new URL(url).origin; } catch { return url || ''; } };
const keyOf = (p: AiProviderSettings) => p.keys?.[originOf(p.baseUrl)];
export interface AiConfig {
  provider: AiProvider;
  anthropic: AiProviderSettings;
  openai: AiProviderSettings & { preset?: string };
  maxTokens: number;
}

export interface AiSecrets { encrypt(s: string): string; decrypt(s: string): string }

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'anthropic',
  anthropic: { model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com' },
  openai: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', preset: 'openai' },
  maxTokens: 4096,
};

/** What the editor sees: everything but the keys (only whether one is set, and its last characters). */
export function publicConfig(c: AiConfig) {
  const pub = (p: AiProviderSettings) => { const k = keyOf(p); return { model: p.model, baseUrl: p.baseUrl, hasKey: !!k, keyHint: k ? `…${k.slice(-4)}` : '' }; };
  return { provider: c.provider, anthropic: pub(c.anthropic), openai: { ...pub(c.openai), preset: c.openai.preset || '' }, maxTokens: c.maxTokens };
}

export class AiService {
  private config: AiConfig | null = null;
  private running = new Map<string, AbortController>();

  constructor(private file: string, private secrets?: AiSecrets) {}

  async load(): Promise<AiConfig> {
    if (this.config) return this.config;
    let c: AiConfig = JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      const dec = (v: any) => {
        if (typeof v !== 'string' || !v) return undefined;
        if (v.startsWith('enc:') && this.secrets) { try { return this.secrets.decrypt(v.slice(4)); } catch { return undefined; } }
        return v.startsWith('enc:') ? undefined : v;
      };
      const keys = (src: any) => { const out: Record<string, string> = {}; for (const [o, v] of Object.entries(src?.keys || {})) { const k = dec(v); if (k) out[o] = k; } return out; };
      c = {
        provider: raw.provider === 'openai' ? 'openai' : 'anthropic',
        anthropic: { ...c.anthropic, ...pick(raw.anthropic), keys: keys(raw.anthropic) },
        openai: { ...c.openai, ...pick(raw.openai), keys: keys(raw.openai), preset: typeof raw.openai?.preset === 'string' ? raw.openai.preset : c.openai.preset },
        maxTokens: clampTokens(raw.maxTokens),
      };
    } catch { /* first run: defaults */ }
    this.config = c;
    return c;
  }

  private async save(): Promise<void> {
    const c = this.config!;
    const enc = (k?: string) => {
      if (!k) return undefined;
      if (this.secrets) { try { return `enc:${this.secrets.encrypt(k)}`; } catch { /* no keychain: the file is only readable by this user */ } }
      return k;
    };
    const keys = (p: AiProviderSettings) => Object.fromEntries(Object.entries(p.keys || {}).map(([o, k]) => [o, enc(k)]));
    const out = {
      provider: c.provider,
      anthropic: { model: c.anthropic.model, baseUrl: c.anthropic.baseUrl, keys: keys(c.anthropic) },
      openai: { model: c.openai.model, baseUrl: c.openai.baseUrl, preset: c.openai.preset, keys: keys(c.openai) },
      maxTokens: c.maxTokens,
    };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, this.file);
  }

  async getPublic() { return publicConfig(await this.load()); }

  /** Update settings. A provider's key changes only when `key` is a non-empty string, or `clearKey` is set. */
  async update(patch: any) {
    const c = await this.load();
    if (patch?.provider === 'anthropic' || patch?.provider === 'openai') c.provider = patch.provider;
    for (const p of ['anthropic', 'openai'] as const) {
      const src = patch?.[p];
      if (!src || typeof src !== 'object') continue;
      Object.assign(c[p], pick(src));
      if (p === 'openai' && typeof src.preset === 'string') c.openai.preset = src.preset;
      const origin = originOf(c[p].baseUrl);
      if (typeof src.key === 'string' && src.key.trim()) c[p].keys = { ...(c[p].keys || {}), [origin]: src.key.trim() };
      if (src.clearKey && c[p].keys) { const k = { ...c[p].keys }; delete k[origin]; c[p].keys = k; }
    }
    if (patch?.maxTokens != null) c.maxTokens = clampTokens(patch.maxTokens);
    await this.save();
    return publicConfig(c);
  }

  cancel(requestId: string): boolean {
    const a = this.running.get(requestId);
    if (a) { a.abort(); this.running.delete(requestId); }
    return !!a;
  }

  /** One model turn: returns the assistant's content blocks and why it stopped. */
  async chat(args: { requestId?: string; system?: string; messages: AiMessage[]; tools?: AiTool[]; maxTokens?: number }): Promise<{ content: AiBlock[]; stopReason: string; usage?: any; model: string }> {
    const c = await this.load();
    const p = c.provider;
    const s = { ...c[p], key: keyOf(c[p]) };
    if (!s.key && !(p === 'openai' && isLocal(s.baseUrl))) throw new Error('NO_KEY');
    if (!s.model) throw new Error('NO_MODEL');
    const ctl = new AbortController();
    const id = args.requestId || Math.random().toString(36).slice(2);
    this.running.set(id, ctl);
    const timer = setTimeout(() => ctl.abort(), 180_000);
    try {
      const maxTokens = clampTokens(args.maxTokens ?? c.maxTokens);
      return p === 'anthropic'
        ? await anthropicChat(s, args, maxTokens, ctl.signal)
        : await openaiChat(s, args, maxTokens, ctl.signal);
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('CANCELLED');
      throw e;
    } finally {
      clearTimeout(timer);
      this.running.delete(id);
    }
  }
}

function pick(src: any): Partial<AiProviderSettings> {
  const out: Partial<AiProviderSettings> = {};
  if (typeof src?.model === 'string') out.model = src.model.trim();
  if (typeof src?.baseUrl === 'string') out.baseUrl = src.baseUrl.trim().replace(/\/+$/, '');
  return out;
}
const clampTokens = (v: any) => Math.max(256, Math.min(64000, Math.round(Number(v) || DEFAULT_AI_CONFIG.maxTokens)));
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url || '');

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.message || j?.error || text.slice(0, 300);
  } catch { return text.slice(0, 300) || res.statusText; }
}

/* ------------------------------------------------------------------ */
/* Anthropic (Claude)                                                   */
/* ------------------------------------------------------------------ */

async function anthropicChat(s: AiProviderSettings & { key?: string }, a: { system?: string; messages: AiMessage[]; tools?: AiTool[] }, maxTokens: number, signal: AbortSignal) {
  const base = (s.baseUrl || DEFAULT_AI_CONFIG.anthropic.baseUrl).replace(/\/v1$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': s.key || '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: s.model,
      max_tokens: maxTokens,
      ...(a.system ? { system: a.system } : {}),
      messages: a.messages,
      ...(a.tools?.length ? { tools: a.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readError(res)}`);
  const j: any = await res.json();
  const content: AiBlock[] = [];
  for (const b of j.content || []) {
    if (b.type === 'text') content.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
  }
  return { content, stopReason: j.stop_reason === 'tool_use' ? 'tool_use' : j.stop_reason === 'max_tokens' ? 'max_tokens' : 'end', usage: j.usage, model: j.model || s.model };
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible Chat Completions                                   */
/* ------------------------------------------------------------------ */

export function toOpenAiMessages(system: string | undefined, messages: AiMessage[]): any[] {
  const out: any[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // Tool results become "tool" messages (they must directly follow the assistant's calls); text follows as a user message.
      // Tool messages only carry text, so pictures from tools follow in a user message.
      const images: AiImage[] = [];
      for (const b of m.content) if (b.type === 'tool_result') {
        const parts = typeof b.content === 'string' ? [{ type: 'text' as const, text: b.content }] : b.content;
        const text = parts.filter((x): x is { type: 'text'; text: string } => x.type === 'text').map((x) => x.text).join('\n');
        images.push(...parts.filter((x): x is AiImage => x.type === 'image'));
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${text}` : text });
      }
      const own = m.content.filter((b): b is AiImage => b.type === 'image');
      const text = m.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (images.length) out.push({ role: 'user', content: [{ type: 'text', text: '(Pictures returned by the tools above.)' }, ...images.map((b) => ({ type: 'image_url', image_url: { url: dataUrl(b) } }))] });
      if (own.length) out.push({ role: 'user', content: [...(text ? [{ type: 'text', text }] : []), ...own.map((b) => ({ type: 'image_url', image_url: { url: dataUrl(b) } }))] });
      else if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

export function fromOpenAiMessage(msg: any): AiBlock[] {
  const content: AiBlock[] = [];
  if (typeof msg?.content === 'string' && msg.content.trim()) content.push({ type: 'text', text: msg.content });
  for (const c of msg?.tool_calls || []) {
    let input: any = {};
    try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { _raw: c.function?.arguments }; }
    content.push({ type: 'tool_use', id: c.id || `call_${Math.random().toString(36).slice(2)}`, name: c.function?.name || '', input });
  }
  return content;
}

async function openaiChat(s: AiProviderSettings & { key?: string }, a: { system?: string; messages: AiMessage[]; tools?: AiTool[] }, maxTokens: number, signal: AbortSignal) {
  const base = s.baseUrl || DEFAULT_AI_CONFIG.openai.baseUrl;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...(s.key ? { authorization: `Bearer ${s.key}` } : {}) },
    body: JSON.stringify({
      model: s.model,
      max_tokens: maxTokens,
      messages: toOpenAiMessages(a.system, a.messages),
      ...(a.tools?.length ? { tools: a.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await readError(res)}`);
  const j: any = await res.json();
  const choice = j.choices?.[0];
  const content = fromOpenAiMessage(choice?.message);
  const fr = choice?.finish_reason;
  return { content, stopReason: fr === 'tool_calls' || content.some((b) => b.type === 'tool_use') ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end', usage: j.usage, model: j.model || s.model };
}
