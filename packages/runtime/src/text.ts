/**
 * Rich text markup shared by dialogue and text layers.
 *
 *   [b]bold[/b]  [i]italic[/i]  [u]underline[/u]  [color=#ff8]tinted[/color]  [size=1.4]bigger[/size]
 *   [wave]wavy[/wave]  [shake]shaky[/shake]
 *   [wait=0.5]  pause the typewriter (dialogue only)
 *   [speed=2]   typewriter speed multiplier until [/speed]
 *   {Variable Name}  replaced by the variable's value
 */

export interface RichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  size?: number;
  wave?: boolean;
  shake?: boolean;
  speed?: number;
}

export type RichToken = { kind: 'run'; run: RichRun } | { kind: 'wait'; seconds: number };

export function interpolateVars(text: string, lookup: (name: string) => string | undefined): string {
  return text.replace(/\{([^{}\n]{1,64})\}/g, (m, name) => {
    const v = lookup(String(name).trim());
    return v === undefined ? m : v;
  });
}

export function parseRich(input: string): RichToken[] {
  const tokens: RichToken[] = [];
  const stack: { tag: string; value?: string }[] = [];
  const state = (): RichRun => {
    const r: RichRun = { text: '' };
    for (const s of stack) {
      if (s.tag === 'b') r.bold = true;
      else if (s.tag === 'i') r.italic = true;
      else if (s.tag === 'u') r.underline = true;
      else if (s.tag === 'color') r.color = s.value;
      else if (s.tag === 'size') r.size = Number(s.value) || 1;
      else if (s.tag === 'wave') r.wave = true;
      else if (s.tag === 'shake') r.shake = true;
      else if (s.tag === 'speed') r.speed = Number(s.value) || 1;
    }
    return r;
  };
  const re = /\[(\/?)(b|i|u|color|size|wave|shake|wait|speed)(?:=([^\]]*))?\]/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string) => {
    if (!text) return;
    tokens.push({ kind: 'run', run: { ...state(), text } });
  };
  while ((m = re.exec(input))) {
    push(input.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'wait') {
      if (!closing) tokens.push({ kind: 'wait', seconds: Number(m[3]) || 0.5 });
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.splice(i, 1); break; }
    } else stack.push({ tag, value: m[3] });
  }
  push(input.slice(last));
  return tokens;
}

export function stripMarkup(input: string): string {
  return parseRich(input).map((t) => (t.kind === 'run' ? t.run.text : '')).join('');
}

/* ------------------------------------------------------------------ */
/* Canvas layout for text layers                                         */
/* ------------------------------------------------------------------ */

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  italic: boolean;
  color: string;
  lineHeight: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
}

export interface LaidGlyphRun {
  text: string;
  x: number;
  width: number;
  run: RichRun;
  font: string;
  size: number;
}

export interface LaidLine {
  runs: LaidGlyphRun[];
  width: number;
  height: number;
  y: number;
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯＀-￯]/;

function fontFor(style: TextStyle, run: RichRun): { font: string; size: number } {
  const size = style.fontSize * (run.size || 1);
  const weight = run.bold ? 'bold' : style.fontWeight;
  const italic = run.italic || style.italic ? 'italic ' : '';
  return { font: `${italic}${weight} ${size}px ${style.fontFamily}`, size };
}

/** Split into breakable pieces: words for Latin text, single characters for CJK. */
function pieces(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '\n') { if (buf) out.push(buf); out.push('\n'); buf = ''; continue; }
    if (CJK.test(ch)) { if (buf) out.push(buf); out.push(ch); buf = ''; continue; }
    buf += ch;
    if (ch === ' ') { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

export function layoutRich(ctx: CanvasRenderingContext2D, tokens: RichToken[], style: TextStyle, maxWidth: number, maxChars = Infinity): { lines: LaidLine[]; width: number; height: number } {
  const lines: LaidLine[] = [];
  let line: LaidLine = { runs: [], width: 0, height: style.fontSize * style.lineHeight, y: 0 };
  let used = 0;
  const measure = (s: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(s).width + style.letterSpacing * [...s].length;
  };
  const newline = () => {
    lines.push(line);
    line = { runs: [], width: 0, height: style.fontSize * style.lineHeight, y: 0 };
  };
  outer: for (const tok of tokens) {
    if (tok.kind !== 'run') continue;
    const { font, size } = fontFor(style, tok.run);
    for (let piece of pieces(tok.run.text)) {
      if (piece === '\n') { newline(); continue; }
      if (used >= maxChars) break outer;
      const remaining = maxChars - used;
      if ([...piece].length > remaining) piece = [...piece].slice(0, remaining).join('');
      used += [...piece].length;
      let w = measure(piece, font);
      if (maxWidth > 0 && line.width + w > maxWidth && line.runs.length) {
        newline();
        if (piece.startsWith(' ')) { piece = piece.trimStart(); w = measure(piece, font); }
      }
      const lastRun = line.runs[line.runs.length - 1];
      if (lastRun && lastRun.run === tok.run) { lastRun.text += piece; lastRun.width += w; }
      else line.runs.push({ text: piece, x: line.width, width: w, run: tok.run, font, size });
      line.width += w;
      line.height = Math.max(line.height, size * style.lineHeight);
    }
  }
  lines.push(line);
  let y = 0;
  let width = 0;
  for (const l of lines) {
    l.y = y;
    y += l.height;
    // trailing spaces do not count for alignment
    const tail = l.runs[l.runs.length - 1];
    if (tail && /\s+$/.test(tail.text)) {
      ctx.font = tail.font;
      const trimmed = tail.text.replace(/\s+$/, '');
      const delta = tail.width - (ctx.measureText(trimmed).width + style.letterSpacing * [...trimmed].length);
      l.width -= delta;
    }
    width = Math.max(width, l.width);
  }
  return { lines, width, height: y };
}

export function drawRich(ctx: CanvasRenderingContext2D, laid: { lines: LaidLine[] }, style: TextStyle, boxWidth: number, time: number, extra?: { stroke?: string; strokeWidth?: number }): void {
  ctx.textBaseline = 'alphabetic';
  for (const line of laid.lines) {
    const offset = style.align === 'center' ? (boxWidth - line.width) / 2 : style.align === 'right' ? boxWidth - line.width : 0;
    const baseline = line.y + line.height * 0.5 + style.fontSize * 0.36;
    for (const r of line.runs) {
      ctx.font = r.font;
      ctx.fillStyle = r.run.color || style.color;
      const animated = r.run.wave || r.run.shake || style.letterSpacing;
      if (!animated) {
        if (extra?.stroke && extra.strokeWidth) { ctx.lineWidth = extra.strokeWidth; ctx.strokeStyle = extra.stroke; ctx.lineJoin = 'round'; ctx.strokeText(r.text, offset + r.x, baseline); }
        ctx.fillText(r.text, offset + r.x, baseline);
      } else {
        let x = offset + r.x;
        let i = 0;
        for (const ch of r.text) {
          let dy = 0, dx = 0;
          if (r.run.wave) dy = Math.sin(time * 6 + i * 0.6) * r.size * 0.12;
          if (r.run.shake) { dx = (Math.random() - 0.5) * r.size * 0.08; dy += (Math.random() - 0.5) * r.size * 0.08; }
          if (extra?.stroke && extra.strokeWidth) { ctx.lineWidth = extra.strokeWidth; ctx.strokeStyle = extra.stroke; ctx.strokeText(ch, x + dx, baseline + dy); }
          ctx.fillText(ch, x + dx, baseline + dy);
          x += ctx.measureText(ch).width + style.letterSpacing;
          i++;
        }
      }
      if (r.run.underline) ctx.fillRect(offset + r.x, baseline + 3, r.width, Math.max(1, r.size / 16));
    }
  }
}

export function countChars(tokens: RichToken[]): number {
  let n = 0;
  for (const t of tokens) if (t.kind === 'run') n += [...t.run.text].length;
  return n;
}
