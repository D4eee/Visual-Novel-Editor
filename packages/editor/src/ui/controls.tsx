import { useEffect, useRef, useState, ReactNode, CSSProperties, KeyboardEvent as RKeyboardEvent } from 'react';
import { Icon } from './Icon';
import { parseColor, colorToHex } from '@vne/runtime';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Button({ children, onClick, kind = 'default', icon, disabled, title, small, type = 'button', className, style, autoFocus }: {
  children?: ReactNode; onClick?: (e: React.MouseEvent) => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; icon?: string; disabled?: boolean; title?: string; small?: boolean; type?: 'button' | 'submit'; className?: string; style?: CSSProperties; autoFocus?: boolean;
}) {
  return (
    <button type={type} className={cx('btn', `btn-${kind}`, small && 'btn-sm', className)} onClick={onClick} disabled={disabled} title={title} style={style} autoFocus={autoFocus}>
      {icon && <Icon name={icon} size={small ? 14 : 16} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, onClick, title, active, disabled, size = 16, className, danger }: { icon: string; onClick?: (e: React.MouseEvent) => void; title: string; active?: boolean; disabled?: boolean; size?: number; className?: string; danger?: boolean }) {
  return (
    <button type="button" className={cx('icon-btn', active && 'active', danger && 'danger', className)} onClick={onClick} title={title} aria-label={title} aria-pressed={active} disabled={disabled}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Text input that commits on blur / Enter and reverts on Escape, so typing does not flood the undo history. */
export function TextInput({ value, onChange, placeholder, multiline, autoFocus, className, rows = 3, onEnter, live, selectOnFocus, spellCheck, ariaLabel, onKeyDown }: {
  value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; autoFocus?: boolean; className?: string; rows?: number;
  onEnter?: () => void; live?: boolean; selectOnFocus?: boolean; spellCheck?: boolean; ariaLabel?: string; onKeyDown?: (e: RKeyboardEvent) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onChange(draft); };
  const common = {
    value: draft,
    placeholder,
    autoFocus,
    spellCheck,
    'aria-label': ariaLabel || placeholder,
    className: cx('input', className),
    onFocus: (e: any) => { focused.current = true; if (selectOnFocus) e.target.select(); },
    onBlur: () => { focused.current = false; commit(); },
    onChange: (e: any) => { setDraft(e.target.value); if (live) onChange(e.target.value); },
    onKeyDown: (e: RKeyboardEvent<any>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { setDraft(value); (e.target as HTMLElement).blur(); }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); onEnter?.(); if (!onEnter) (e.target as HTMLElement).blur(); }
      e.stopPropagation();
    },
  };
  return multiline ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />;
}

/** Number field with drag-to-scrub on the label, arrow-key stepping and expression-free parsing. */
export function NumberInput({ value, onChange, min, max, step = 1, unit, label, onScrubStart, onScrubEnd, className, disabled, title }: {
  value: number; onChange: (v: number, transient?: boolean) => void; min?: number; max?: number; step?: number; unit?: string; label?: ReactNode;
  onScrubStart?: () => void; onScrubEnd?: () => void; className?: string; disabled?: boolean; title?: string;
}) {
  const [draft, setDraft] = useState(fmt(value, step));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(fmt(value, step)); }, [value, step]);
  const clampV = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const commit = (s: string) => {
    const v = Number(s.replace(',', '.'));
    if (Number.isFinite(v)) onChange(clampV(v));
    else setDraft(fmt(value, step));
  };
  const scrub = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let moved = false;
    onScrubStart?.();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      onChange(clampV(roundTo(start + dx * step * mult, step)), true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('scrubbing');
      onScrubEnd?.();
    };
    document.body.classList.add('scrubbing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={cx('num-input', disabled && 'disabled', className)} title={title}>
      {label !== undefined && <span className="num-label" onPointerDown={scrub}>{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={typeof label === 'string' ? label : title}
        onFocus={(e) => { focused.current = true; e.target.select(); }}
        onBlur={() => { focused.current = false; commit(draft); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { commit(draft); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(fmt(value, step)); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clampV(roundTo(value + d, step));
            onChange(v);
            setDraft(fmt(v, step));
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
    </div>
  );
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step || 1)));
  return Number(v.toFixed(Math.min(6, decimals + 1)));
}

function fmt(v: number, step: number): string {
  if (!Number.isFinite(v)) return '0';
  const decimals = Math.max(0, -Math.floor(Math.log10(step || 1)));
  return String(Number(v.toFixed(Math.min(6, decimals + 1))));
}

export function ColorInput({ value, onChange, title }: { value: string; onChange: (v: string, transient?: boolean) => void; title?: string }) {
  const c = parseColor(value);
  const hex = colorToHex({ ...c, a: 1 });
  return (
    <div className="color-input" title={title}>
      <label className="swatch" style={{ background: `linear-gradient(${value}, ${value}), repeating-conic-gradient(#888 0 25%, #555 0 50%) 0 0 / 8px 8px` }}>
        <input type="color" value={hex} aria-label={title || 'color'} onChange={(e) => {
          const n = parseColor(e.target.value);
          onChange(c.a < 1 ? `rgba(${n.r}, ${n.g}, ${n.b}, ${c.a})` : e.target.value, true);
        }} onBlur={(e) => {
          const n = parseColor(e.target.value);
          onChange(c.a < 1 ? `rgba(${n.r}, ${n.g}, ${n.b}, ${c.a})` : e.target.value);
        }} />
      </label>
      <TextInput value={value} onChange={(v) => onChange(v)} className="color-text" ariaLabel={title || 'color'} />
      <input className="alpha" type="range" min={0} max={1} step={0.01} value={c.a} aria-label="alpha" title="Alpha"
        onChange={(e) => onChange(`rgba(${c.r}, ${c.g}, ${c.b}, ${e.target.value})`, true)}
        onPointerUp={(e) => onChange(`rgba(${c.r}, ${c.g}, ${c.b}, ${(e.target as HTMLInputElement).value})`)} />
    </div>
  );
}

export function Select<T extends string | number>({ value, options, onChange, className, title, placeholder, disabled }: {
  value: T | null | undefined; options: { value: T; label: string; disabled?: boolean; group?: string }[]; onChange: (v: T) => void; className?: string; title?: string; placeholder?: string; disabled?: boolean;
}) {
  const groups = [...new Set(options.map((o) => o.group || ''))];
  const render = (opts: typeof options) => opts.map((o) => <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}</option>);
  return (
    <div className={cx('select', className)} title={title}>
      <select value={value === null || value === undefined ? '' : String(value)} disabled={disabled} aria-label={title || placeholder}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}>
        {(value === null || value === undefined || !options.some((o) => o.value === value)) && <option value="">{placeholder ?? '—'}</option>}
        {groups.length > 1 ? groups.map((g) => <optgroup key={g} label={g}>{render(options.filter((o) => (o.group || '') === g))}</optgroup>) : render(options)}
      </select>
      <Icon name="chevronDown" size={14} className="select-caret" />
    </div>
  );
}

export function Toggle({ value, onChange, label, title }: { value: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function Checkbox({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Field({ label, children, hint, wide, actions }: { label: ReactNode; children: ReactNode; hint?: ReactNode; wide?: boolean; actions?: ReactNode }) {
  return (
    <div className={cx('field', wide && 'field-wide')}>
      <div className="field-label">{label}{actions && <span className="field-actions">{actions}</span>}</div>
      <div className="field-control">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, actions, id }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode; id?: string }) {
  const key = id ? `vne.section.${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!key) return defaultOpen;
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  return (
    <section className={cx('section', open && 'open')}>
      <header className="section-head">
        <button type="button" className="section-toggle" onClick={() => { setOpen(!open); if (key) try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* ignore */ } }} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
          <span>{title}</span>
        </button>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, className, right }: { value: T; tabs: { id: T; label: ReactNode; icon?: string; badge?: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string; right?: ReactNode }) {
  return (
    <div className={cx('tabs', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={cx('tab', t.id === value && 'active')} onClick={() => onChange(t.id)} title={t.title}>
          {t.icon && <Icon name={t.icon} size={14} />}
          <span>{t.label}</span>
          {t.badge !== undefined && t.badge !== null && t.badge !== 0 && <span className="badge">{t.badge}</span>}
        </button>
      ))}
      {right && <div className="tabs-right">{right}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} size={28} className="empty-icon" />}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function shortcut(s: string): string {
  return s.replace('Mod', MOD).replace('Shift', isMac ? '⇧' : 'Shift').replace('Alt', isMac ? '⌥' : 'Alt');
}

/** Horizontal or vertical drag handle that resizes a panel and remembers its size. */
export function useResizable(key: string, initial: number, min: number, max: number): [number, (e: React.PointerEvent, dir: 1 | -1, axis?: 'x' | 'y') => void] {
  const [size, setSize] = useState(() => {
    try { const v = Number(localStorage.getItem(`vne.size.${key}`)); return v ? Math.max(min, Math.min(max, v)) : initial; } catch { return initial; }
  });
  const start = (e: React.PointerEvent, dir: 1 | -1, axis: 'x' | 'y' = 'x') => {
    e.preventDefault();
    const s0 = size;
    const p0 = axis === 'x' ? e.clientX : e.clientY;
    let cur = s0;
    const move = (ev: PointerEvent) => {
      cur = Math.max(min, Math.min(max, s0 + ((axis === 'x' ? ev.clientX : ev.clientY) - p0) * dir));
      setSize(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove(axis === 'x' ? 'resizing-x' : 'resizing-y');
      try { localStorage.setItem(`vne.size.${key}`, String(cur)); } catch { /* ignore */ }
    };
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return [size, start];
}
