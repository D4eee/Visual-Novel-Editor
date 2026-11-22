/**
 * A plain-text screenplay format that imports as scenes, dialogue lines and choices.
 *
 *   # Chapter name                 (optional; starts a chapter)
 *   ## Scene name                  starts a scene
 *   [bg: #1b1d2a] or [bg: Street]  background color, or a background image by asset name
 *   [music: Theme]                 background music by asset name
 *   [voice: line01]                the voice for the next line
 *   Alice: Hello.                  a line said by Alice (a full-width colon works too)
 *   Alice (smile): Hi!             …with Alice's "smile" portrait
 *   The rain stopped.              narration (a line without a speaker)
 *   > Note: it was late.           narration that contains a colon
 *   * Go left -> Left path         a choice leading to the scene "Left path"
 *   -> Next scene                  where the scene continues (-> END ends the game)
 *   // comment                     ignored
 *
 * Scenes without choices and without "->" continue to the next scene of the same chapter.
 */

export interface ScriptLine { speaker: string | null; portrait: string | null; text: string; voice: string | null; line: number }
export interface ScriptChoice { text: string; target: string | null; line: number }
export interface ScriptScene {
  name: string | null;
  line: number;
  background: string | null;
  music: string | null;
  lines: ScriptLine[];
  choices: ScriptChoice[];
  /** undefined: continue to the next scene; null: stop; 'END': an ending. */
  next?: string | null;
}
export interface ScriptChapter { name: string | null; scenes: ScriptScene[] }
export interface ParsedScript {
  chapters: ScriptChapter[];
  /** Speaker names in order of first appearance. */
  speakers: string[];
  warnings: { line: number; code: string; text: string }[];
}

const END = /^(end|the end|ending|结束|完|终)$/i;
export const isEndTarget = (s: string) => END.test(s.trim());

/** Speaker part before the colon: short, no sentence punctuation. */
const SPEAKER = /^([^:：\[\]{}<>*#/"“”。，！？!?,.]{1,24}?)\s*(?:[(（]([^)）]{1,24})[)）])?\s*[:：]\s*(.*)$/;

export function parseScript(src: string): ParsedScript {
  const out: ParsedScript = { chapters: [], speakers: [], warnings: [] };
  let chapter: ScriptChapter | null = null;
  let scene: ScriptScene | null = null;
  let voice: string | null = null;
  const speakers = new Set<string>();
  const chap = () => { if (!chapter) { chapter = { name: null, scenes: [] }; out.chapters.push(chapter); } return chapter; };
  const startScene = (name: string | null, line: number) => { scene = { name, line, background: null, music: null, lines: [], choices: [] }; chap().scenes.push(scene); return scene; };
  const cur = (line: number) => scene || startScene(null, line);

  const rows = src.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  rows.forEach((raw, i) => {
    const n = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith('//')) return;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^##\s*(.+)$/))) { startScene(m[1].trim(), n); voice = null; return; }
    if ((m = s.match(/^#\s*(.+)$/))) { chapter = { name: m[1].trim(), scenes: [] }; out.chapters.push(chapter); scene = null; voice = null; return; }
    if ((m = s.match(/^[[【]\s*(bg|background|背景|music|bgm|音乐|voice|语音)\s*[:：]\s*(.*?)\s*[\]】]$/i))) {
      const key = m[1].toLowerCase();
      const v = m[2].trim();
      if (/^(bg|background|背景)$/.test(key)) cur(n).background = v || null;
      else if (/^(music|bgm|音乐)$/.test(key)) cur(n).music = v || null;
      else voice = v || null;
      return;
    }
    if ((m = s.match(/^[*＊]\s*(.+?)\s*(?:(?:->|→)\s*(.*))?$/))) {
      const sc = cur(n);
      const text = m[1].trim();
      if (!text) { out.warnings.push({ line: n, code: 'emptyChoice', text: s }); return; }
      sc.choices.push({ text, target: m[2]?.trim() || null, line: n });
      return;
    }
    if ((m = s.match(/^(?:->|→)\s*(.*)$/))) {
      const sc = cur(n);
      const target = m[1].trim();
      if (sc.next !== undefined) out.warnings.push({ line: n, code: 'twoNext', text: s });
      sc.next = !target ? null : isEndTarget(target) ? 'END' : target;
      return;
    }
    const sc = cur(n);
    if (s.startsWith('>')) { sc.lines.push({ speaker: null, portrait: null, text: s.slice(1).trim(), voice, line: n }); voice = null; return; }
    if ((m = s.match(SPEAKER)) && m[3]) {
      const name = m[1].trim();
      const narrator = /^(narrator|narration|旁白)$/i.test(name);
      if (!narrator && !speakers.has(name)) { speakers.add(name); out.speakers.push(name); }
      sc.lines.push({ speaker: narrator ? null : name, portrait: m[2]?.trim() || null, text: m[3].trim(), voice, line: n });
    } else {
      sc.lines.push({ speaker: null, portrait: null, text: s, voice, line: n });
    }
    voice = null;
  });

  // A scene's choices replace "continue"; both at once means "->" is ignored.
  for (const c of out.chapters) for (const sc of c.scenes) if (sc.choices.length && sc.next) { out.warnings.push({ line: sc.line, code: 'choicesAndNext', text: sc.name || '' }); sc.next = null; }
  // Targets must name a scene of the script (the editor also accepts existing scenes).
  return out;
}

/** Every scene name a choice or "->" points to. */
export function scriptTargets(p: ParsedScript): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  for (const c of p.chapters) for (const sc of c.scenes) {
    for (const ch of sc.choices) if (ch.target && !isEndTarget(ch.target)) out.push({ target: ch.target, line: ch.line });
    if (sc.next && sc.next !== 'END') out.push({ target: sc.next, line: sc.line });
  }
  return out;
}

export function scriptStats(p: ParsedScript) {
  let scenes = 0, lines = 0, choices = 0;
  for (const c of p.chapters) for (const sc of c.scenes) { scenes++; lines += sc.lines.length; choices += sc.choices.length; }
  return { chapters: p.chapters.filter((c) => c.name).length, scenes, lines, choices, speakers: p.speakers.length };
}
