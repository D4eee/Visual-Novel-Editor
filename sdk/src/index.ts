/**
 * @vne/sdk — helpers for module authors. Modules do not need to import this at
 * runtime (the engine passes the API to `activate`), but these helpers make
 * editor UIs and typed definitions easier to write. Bundle what you use, or copy
 * sdk/dist/index.js next to your module.
 */

export const SDK_VERSION = '1.0.0';

/** Identity helpers that give you editor autocompletion with JSDoc/TypeScript. */
export function defineRuntime<T extends (api: any) => any>(activate: T): T {
  return activate;
}

export function defineEditor<T extends (api: any) => any>(activate: T): T {
  return activate;
}

type Child = Node | string | number | null | undefined | false;

/** Minimal hyperscript for building editor UIs without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, any> | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Controls styled like the editor (uses the editor's CSS classes). */
export const ui = {
  button(label: string, onClick: () => void, opts: { primary?: boolean; small?: boolean } = {}): HTMLButtonElement {
    return h('button', { type: 'button', class: `btn ${opts.primary ? 'btn-primary' : ''} ${opts.small ? 'btn-sm' : ''}`, onclick: onClick }, label);
  },
  field(label: string, control: HTMLElement, hint?: string): HTMLElement {
    return h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), h('div', { class: 'field-control' }, control), hint ? h('div', { class: 'field-hint' }, hint) : null);
  },
  text(value: string, onChange: (v: string) => void, opts: { placeholder?: string; multiline?: boolean } = {}) {
    const el = opts.multiline ? h('textarea', { class: 'input', rows: 3, placeholder: opts.placeholder || '' }) : h('input', { class: 'input', type: 'text', placeholder: opts.placeholder || '' });
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    el.addEventListener('keydown', (e) => e.stopPropagation());
    return el;
  },
  number(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number } = {}): HTMLInputElement {
    const el = h('input', { class: 'input', type: 'number', min: opts.min, max: opts.max, step: opts.step ?? 1 });
    el.value = String(value);
    el.addEventListener('change', () => onChange(Number(el.value) || 0));
    el.addEventListener('keydown', (e) => e.stopPropagation());
    return el;
  },
  slider(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number } = {}): HTMLInputElement {
    const el = h('input', { type: 'range', min: opts.min ?? 0, max: opts.max ?? 100, step: opts.step ?? 1, style: { accentColor: 'var(--accent)', width: '100%' } });
    el.value = String(value);
    el.addEventListener('change', () => onChange(Number(el.value)));
    return el;
  },
  select(value: string, options: { value: string; label: string }[], onChange: (v: string) => void): HTMLSelectElement {
    const el = h('select', { class: 'input' }, ...options.map((o) => h('option', { value: o.value }, o.label)));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  },
  checkbox(value: boolean, onChange: (v: boolean) => void, label = ''): HTMLLabelElement {
    const input = h('input', { type: 'checkbox' });
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'checkbox' }, input, h('span', null, label));
  },
  color(value: string, onChange: (v: string) => void): HTMLInputElement {
    const el = h('input', { type: 'color', style: { width: '40px', height: '28px', border: '0', background: 'transparent' } });
    el.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
    el.addEventListener('change', () => onChange(el.value));
    return el;
  },
};
