/**
 * Multi-language works: the project is written in one language (`source`) and can be offered
 * in others. Every piece of text players see gets a stable key; a translation table maps keys
 * to translated text per language. `localizeProject` gives the game a copy of the project in
 * one language (missing translations fall back to the source text).
 *
 * Keys:
 * - `line:<lineId>`              a dialogue line
 * - `prop:<layerId>:<propKey>`   a text property of an element (text, button, choice, free dialogue…)
 * - `arg:<blockId>:<argId>`      a text argument of a script block (marked `translatable`)
 * - `choice:<choiceId>`          a choice of a story node
 * - `char:<characterId>`         a character's name
 * - `meta:title`, `meta:description`
 */
import type { Block, Layer, Project, StoryNode } from './types';
import type { Engine, PropDef } from './registry';
import { DIALOGUE_LAYER } from './elements';

export interface TranslationEntry {
  /** Translated text. */
  t: string;
  /** The source text it was translated from (to spot translations whose source has changed). */
  s?: string;
}

export interface Localization {
  /** The language the project is written in. */
  source: string;
  /** Other languages the game is offered in. */
  languages: string[];
  /** language → key → translation */
  strings: Record<string, Record<string, TranslationEntry>>;
}

/** Languages offered in the editor, with their own names. */
export const LANGUAGES: { code: string; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'zh-CN', name: '简体中文', english: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: '繁體中文', english: 'Chinese (Traditional)' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ko', name: '한국어', english: 'Korean' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'pt-BR', name: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'th', name: 'ไทย', english: 'Thai' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ar', name: 'العربية', english: 'Arabic' },
];
export const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name || code;

export interface TextEntry {
  key: string;
  text: string;
  /** Where the text is, for people: node (scene) and element or speaker. */
  nodeId: string | null;
  nodeName: string;
  kind: 'line' | 'prop' | 'arg' | 'choice' | 'character' | 'meta';
  /** Element, speaker, block or field name. */
  label: string;
}

/** A layer property players read as text. */
export function isTranslatableProp(def: PropDef | undefined): boolean {
  if (!def) return false;
  if (def.translatable != null) return def.translatable;
  return def.type === 'text' || (def.type === 'string' && def.key === 'text');
}

const literalString = (v: any): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && v.k === 'lit' && typeof v.v === 'string' ? v.v : null);

function walkBlocks(blocks: (Block | null | undefined)[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    if (!b) continue;
    fn(b);
    for (const v of Object.values(b.args || {})) if (v && typeof v === 'object' && (v as any).block) walkBlocks([(v as any).block], fn);
    if (b.body) walkBlocks(b.body, fn);
    if (b.else) walkBlocks(b.else, fn);
  }
}

function layersOf(node: StoryNode): Layer[] {
  const d: any = node.data;
  return d && Array.isArray(d.layers) ? d.layers : [];
}
function scriptsOf(node: StoryNode): { hat: Block; body: Block[] }[] {
  const d: any = node.data;
  return d && Array.isArray(d.scripts) ? d.scripts : [];
}

/** Every text players see, in story order (chapter by chapter, node by node). */
export function collectTexts(engine: Engine, project: Project): TextEntry[] {
  const out: TextEntry[] = [];
  const push = (e: TextEntry) => { if (e.text && e.text.trim()) out.push(e); };
  push({ key: 'meta:title', text: project.settings.title || '', nodeId: null, nodeName: '', kind: 'meta', label: 'title' });
  if (project.settings.description) push({ key: 'meta:description', text: project.settings.description, nodeId: null, nodeName: '', kind: 'meta', label: 'description' });
  for (const c of project.characters) push({ key: `char:${c.id}`, text: c.name, nodeId: null, nodeName: '', kind: 'character', label: c.name });
  const order = new Map(project.chapters.map((c, i) => [c.id, i]));
  const nodes = Object.values(project.nodes).sort((a, b) => (order.get(a.chapterId) ?? 99) - (order.get(b.chapterId) ?? 99) || a.y - b.y || a.x - b.x);
  const charName = (id: string | null | undefined) => (id ? project.characters.find((c) => c.id === id)?.name || '' : '');
  const fromLayers = (layers: Layer[], nodeId: string | null, nodeName: string) => {
    for (const l of layers) {
      if (l.type === DIALOGUE_LAYER) {
        for (const line of (l.props.lines as any[]) || []) push({ key: `line:${line.id}`, text: String(line.text ?? ''), nodeId, nodeName, kind: 'line', label: charName(line.speakerId) || line.speakerName || '' });
        continue;
      }
      for (const def of engine.layerProps(l.type)) {
        if (!isTranslatableProp(def)) continue;
        const v = l.props[def.key];
        if (typeof v === 'string') push({ key: `prop:${l.id}:${def.key}`, text: v, nodeId, nodeName, kind: 'prop', label: l.name });
      }
    }
  };
  for (const n of nodes) {
    fromLayers(layersOf(n), n.id, n.name);
    const d: any = n.data;
    for (const ch of (d && Array.isArray(d.choices) ? d.choices : [])) if (ch && ch.id && typeof ch.text === 'string') push({ key: `choice:${ch.id}`, text: ch.text, nodeId: n.id, nodeName: n.name, kind: 'choice', label: '' });
    for (const st of scriptsOf(n)) walkBlocks([st.hat, ...(st.body || [])], (b) => {
      const def = engine.blocks.get(b.type);
      for (const a of def?.args || []) {
        if (!a.translatable) continue;
        const s = literalString(b.args?.[a.id]);
        if (s != null) push({ key: `arg:${b.id}:${a.id}`, text: s, nodeId: n.id, nodeName: n.name, kind: 'arg', label: a.id });
      }
    });
  }
  for (const c of project.compositions || []) fromLayers(c.layers || [], null, c.name);
  return out;
}

/** The translation of a key, or null (missing, or empty). */
export function translationOf(project: Project, locale: string, key: string): TranslationEntry | null {
  const loc = project.localization as Localization | undefined;
  const e = loc?.strings?.[locale]?.[key];
  return e && e.t ? e : null;
}

/** Progress of one language: how many texts are translated, and how many of those are out of date. */
export function translationProgress(engine: Engine, project: Project, locale: string, texts = collectTexts(engine, project)) {
  let done = 0, outdated = 0;
  for (const e of texts) {
    const tr = translationOf(project, locale, e.key);
    if (tr) { done++; if (tr.s != null && tr.s !== e.text) outdated++; }
  }
  return { total: texts.length, done, outdated };
}

/** The languages players can pick: the source language first. */
export function projectLanguages(project: Project): string[] {
  const loc = project.localization as Localization | undefined;
  if (!loc) return [];
  return [loc.source, ...loc.languages.filter((l) => l !== loc.source)];
}

/**
 * A copy of the project with its texts in `locale` (missing translations keep the source text).
 * Returns the project itself for the source language or when there is no translation table.
 */
export function localizeProject<P extends Project>(engine: Engine, project: P, locale: string | null | undefined): P {
  const loc = project.localization as Localization | undefined;
  if (!loc || !locale || locale === loc.source || !loc.strings?.[locale]) return project;
  const table = loc.strings[locale];
  const tr = (key: string, fallback: string) => (table[key]?.t ? table[key].t : fallback);
  const p: P = JSON.parse(JSON.stringify(project));
  p.settings.title = tr('meta:title', p.settings.title);
  if (p.settings.description) p.settings.description = tr('meta:description', p.settings.description);
  for (const c of p.characters) c.name = tr(`char:${c.id}`, c.name);
  const fixLayers = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.type === DIALOGUE_LAYER) { for (const line of (l.props.lines as any[]) || []) line.text = tr(`line:${line.id}`, line.text); continue; }
      for (const def of engine.layerProps(l.type)) if (isTranslatableProp(def) && typeof l.props[def.key] === 'string') l.props[def.key] = tr(`prop:${l.id}:${def.key}`, l.props[def.key] as string);
    }
  };
  for (const n of Object.values(p.nodes)) {
    fixLayers(layersOf(n));
    const d: any = n.data;
    for (const ch of (d && Array.isArray(d.choices) ? d.choices : [])) if (ch && typeof ch.text === 'string') ch.text = tr(`choice:${ch.id}`, ch.text);
    for (const st of scriptsOf(n)) walkBlocks([st.hat, ...(st.body || [])], (b) => {
      const def = engine.blocks.get(b.type);
      for (const a of def?.args || []) {
        if (!a.translatable) continue;
        const v = b.args?.[a.id];
        const s = literalString(v);
        if (s == null) continue;
        const t2 = tr(`arg:${b.id}:${a.id}`, s);
        b.args[a.id] = typeof v === 'string' ? t2 : { ...(v as any), v: t2 };
      }
    });
  }
  for (const c of p.compositions || []) fixLayers(c.layers || []);
  return p;
}

/** The best language for a player: a saved choice, else the first system language the game offers, else the source. */
export function pickLanguage(project: Project, saved: string | null | undefined, system: readonly string[] = []): string | null {
  const langs = projectLanguages(project);
  if (!langs.length) return null;
  if (saved && langs.includes(saved)) return saved;
  for (const s of system) {
    const exact = langs.find((l) => l.toLowerCase() === s.toLowerCase());
    if (exact) return exact;
    const base = s.split('-')[0].toLowerCase();
    // zh-HK / zh-TW → zh-TW when offered; other zh → zh-CN
    if (base === 'zh') { const want = /tw|hk|mo|hant/i.test(s) ? 'zh-TW' : 'zh-CN'; if (langs.includes(want)) return want; }
    const near = langs.find((l) => l.split('-')[0].toLowerCase() === base);
    if (near) return near;
  }
  return langs[0];
}

/* ------------------------------------------------------------------ */
/* CSV (for translators working in a spreadsheet)                       */
/* ------------------------------------------------------------------ */

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function translationsToCsv(texts: TextEntry[], project: Project, locale: string): string {
  const rows = [['key', 'where', 'source', locale]];
  for (const e of texts) rows.push([e.key, [e.nodeName, e.label].filter(Boolean).join(' · '), e.text, translationOf(project, locale, e.key)?.t || '']);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

/** Read translations from CSV made by `translationsToCsv` (key column + a column named after the language). */
export function csvTranslations(csv: string, locale: string): Record<string, string> {
  const rows = parseCsv(csv);
  if (!rows.length) return {};
  const head = rows[0].map((h) => h.trim());
  const k = head.indexOf('key');
  let t = head.indexOf(locale);
  if (t < 0) t = head.length - 1;
  if (k < 0) throw new Error('The CSV has no "key" column.');
  const out: Record<string, string> = {};
  for (const r of rows.slice(1)) if (r[k]) out[r[k]] = r[t] ?? '';
  return out;
}
