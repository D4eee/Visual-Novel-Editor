import type { TextboxStyle } from '@vne/core';
import { parseRich, RichToken } from './text';

export interface LineView {
  name: string;
  nameColor?: string;
  portraitUrl?: string | null;
  text: string;
}

export interface ChoiceView {
  id: string;
  text: string;
  disabled: boolean;
}

export interface Typing {
  done: Promise<void>;
  finished: boolean;
  complete(): void;
}

/**
 * Dialogue box and choice list, drawn as DOM inside the stage overlay so text is
 * crisp, selectable by assistive tech and identical in editor and game.
 */
export class NarrativeUI {
  readonly box: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private portrait: HTMLImageElement;
  readonly choices: HTMLDivElement;
  private typing: { chars: HTMLElement[]; index: number; waits: Map<number, number>; speeds: number[]; acc: number; hold: number; resolve: () => void; finished: boolean } | null = null;
  visible = true;

  constructor(readonly overlay: HTMLElement) {
    this.box = el('div', 'vne-textbox pos-bottom');
    this.portrait = document.createElement('img');
    this.portrait.className = 'vne-portrait';
    this.portrait.hidden = true;
    this.portrait.alt = '';
    const body = el('div', 'vne-tb-body');
    this.nameEl = el('div', 'vne-name');
    this.textEl = el('div', 'vne-text');
    this.textEl.setAttribute('aria-live', 'polite');
    body.append(this.nameEl, this.textEl);
    this.box.append(this.portrait, body, el('div', 'vne-next'));
    this.choices = el('div', 'vne-choices');
    this.choices.setAttribute('role', 'menu');
    overlay.append(this.box, this.choices);
    this.setBoxVisible(false);
  }

  applyStyle(s: TextboxStyle): void {
    const o = this.overlay.style;
    o.setProperty('--vne-font', s.fontFamily);
    o.setProperty('--vne-font-size', `${s.fontSize}px`);
    o.setProperty('--vne-line-height', String(s.lineHeight));
    o.setProperty('--vne-text', s.textColor);
    o.setProperty('--vne-name', s.nameColor);
    o.setProperty('--vne-margin', `${s.margin}px`);
    o.setProperty('--vne-tb-height', `${s.height}px`);
    o.setProperty('--vne-tb-bg', s.background);
    o.setProperty('--vne-tb-border', s.borderColor);
    o.setProperty('--vne-tb-radius', `${s.borderRadius}px`);
    o.setProperty('--vne-tb-pad', `${s.padding}px`);
    o.setProperty('--vne-choice-bg', s.choiceBackground);
    o.setProperty('--vne-choice-hover', s.choiceHover);
    o.setProperty('--vne-choice-text', s.choiceTextColor);
    this.box.classList.remove('pos-bottom', 'pos-top', 'pos-center');
    this.box.classList.add(`pos-${s.position}`);
    this.showPortraits = s.showPortrait;
  }

  private showPortraits = true;

  setBoxVisible(v: boolean): void {
    this.visible = v;
    this.box.classList.toggle('hidden', !v);
  }

  /** Start showing a line with the typewriter. `cps` = characters per second, 0 = instant. */
  showLine(line: LineView, cps: number): Typing {
    this.setBoxVisible(true);
    this.box.classList.remove('done');
    this.nameEl.textContent = line.name || '';
    this.nameEl.style.color = line.nameColor || '';
    if (line.portraitUrl && this.showPortraits) { this.portrait.src = line.portraitUrl; this.portrait.hidden = false; }
    else { this.portrait.hidden = true; this.portrait.removeAttribute('src'); }
    const { chars, waits, speeds } = this.renderTokens(parseRich(line.text));
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const state = { chars, index: 0, waits, speeds, acc: 0, hold: 0, resolve, finished: false };
    this.typing = state;
    this.cps = cps;
    if (cps <= 0 || chars.length === 0) this.finishTyping();
    const typing: Typing = {
      done,
      get finished() { return state.finished; },
      complete: () => { if (this.typing === state) this.finishTyping(); },
    };
    return typing;
  }

  private cps = 40;

  /** Advance the typewriter. Called every frame by the runtime with game-time delta. */
  tick(dt: number): void {
    const t = this.typing;
    if (!t || t.finished) return;
    if (t.hold > 0) { t.hold -= dt; return; }
    t.acc += dt * this.cps * (t.speeds[t.index] || 1);
    while (t.acc >= 1 && t.index < t.chars.length) {
      t.chars[t.index].classList.add('on');
      t.index++;
      t.acc -= 1;
      const w = t.waits.get(t.index);
      if (w) { t.hold = w; t.acc = 0; break; }
    }
    if (t.index >= t.chars.length) this.finishTyping();
  }

  private finishTyping(): void {
    const t = this.typing;
    if (!t) return;
    for (const c of t.chars) c.classList.add('on');
    t.index = t.chars.length;
    if (!t.finished) {
      t.finished = true;
      this.box.classList.add('done');
      t.resolve();
    }
  }

  get isTyping(): boolean {
    return !!this.typing && !this.typing.finished;
  }

  private renderTokens(tokens: RichToken[]): { chars: HTMLElement[]; waits: Map<number, number>; speeds: number[] } {
    this.textEl.textContent = '';
    const chars: HTMLElement[] = [];
    const waits = new Map<number, number>();
    const speeds: number[] = [];
    for (const tok of tokens) {
      if (tok.kind === 'wait') { waits.set(chars.length, (waits.get(chars.length) || 0) + tok.seconds); continue; }
      const r = tok.run;
      for (const ch of r.text) {
        const span = document.createElement('span');
        span.className = 'ch';
        span.textContent = ch;
        if (r.bold) span.style.fontWeight = '700';
        if (r.italic) span.style.fontStyle = 'italic';
        if (r.underline) span.style.textDecoration = 'underline';
        if (r.color) span.style.color = r.color;
        if (r.size && r.size !== 1) span.style.fontSize = `${r.size}em`;
        if (r.wave) { span.classList.add('wave'); span.style.animationDelay = `${(chars.length % 12) * -0.1}s`; }
        if (r.shake) span.classList.add('shake');
        this.textEl.append(span);
        chars.push(span);
        speeds.push(r.speed || 1);
      }
    }
    return { chars, waits, speeds };
  }

  /** Static rendering for the editor (no typewriter). */
  renderStatic(line: LineView | null, choices: ChoiceView[] | null, boxVisible = true): void {
    this.typing = null;
    if (line && boxVisible) {
      this.showLine(line, 0);
    } else this.setBoxVisible(false);
    this.box.classList.remove('done');
    if (choices && choices.length) this.showChoices(choices, () => {});
    else this.hideChoices();
  }

  showChoices(list: ChoiceView[], onPick: (id: string) => void): void {
    this.choices.textContent = '';
    list.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'vne-choice';
      b.setAttribute('role', 'menuitem');
      b.disabled = c.disabled;
      b.dataset.choiceId = c.id;
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = String(i + 1);
      b.append(n, document.createTextNode(c.text));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (!c.disabled) onPick(c.id); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.choices.append(b);
    });
    this.choices.style.display = list.length ? 'flex' : 'none';
  }

  hideChoices(): void {
    this.choices.textContent = '';
    this.choices.style.display = 'none';
  }

  get choicesOpen(): boolean {
    return this.choices.childElementCount > 0;
  }

  /** Pick by number key (1-9). Returns true if handled. */
  pickByIndex(i: number): boolean {
    const b = this.choices.children[i] as HTMLButtonElement | undefined;
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }

  dispose(): void {
    this.box.remove();
    this.choices.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
