import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { cx } from './controls';

export interface MenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
  /** Section header (non-interactive). */
  header?: boolean;
  hint?: string;
}

interface MenuState { x: number; y: number; items: MenuItem[]; search?: boolean; onClose?: () => void; title?: string }

let state: MenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

/** Open a context menu at a screen position (or at the pointer of an event). */
export function openMenu(at: { clientX: number; clientY: number } | { x: number; y: number }, items: MenuItem[], opts: { search?: boolean; onClose?: () => void; title?: string } = {}): void {
  const x = 'clientX' in at ? at.clientX : at.x;
  const y = 'clientY' in at ? at.clientY : at.y;
  state?.onClose?.();
  state = { x, y, items, ...opts };
  emit();
}

export function closeMenu(): void {
  const s = state;
  state = null;
  emit();
  s?.onClose?.();
}

export function openMenuBelow(el: HTMLElement, items: MenuItem[], opts: { search?: boolean; title?: string } = {}): void {
  const r = el.getBoundingClientRect();
  openMenu({ x: r.left, y: r.bottom + 4 }, items, opts);
}

export function MenuHost() {
  const s = useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
  if (!s) return null;
  return <MenuPanel key={`${s.x},${s.y}`} state={s} />;
}

function flatten(items: MenuItem[], prefix = ''): { item: MenuItem; path: string }[] {
  const out: { item: MenuItem; path: string }[] = [];
  for (const it of items) {
    if (it.submenu) out.push(...flatten(it.submenu, `${prefix}${it.label} › `));
    else if (!it.separator && !it.header && it.label) out.push({ item: it, path: prefix });
  }
  return out;
}

function MenuPanel({ state: s }: { state: MenuState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: s.x, y: s.y });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const filtered = query ? flatten(s.items).filter(({ item, path }) => `${path}${item.label}`.toLowerCase().includes(query.toLowerCase())) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = s.x, y = s.y;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - r.width - 8);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x, y });
  }, [s.x, s.y]);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.menu')) closeMenu(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', closeMenu);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); window.removeEventListener('blur', closeMenu); };
  }, []);

  const run = (it: MenuItem) => { if (it.disabled || !it.onClick) return; closeMenu(); it.onClick(); };

  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {s.title && <div className="menu-title">{s.title}</div>}
      {s.search && (
        <input className="menu-search" autoFocus placeholder="Search…" value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            const list = filtered || flatten(s.items).map((x) => x);
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); const it = list[active]?.item; if (it) run(it); }
            if (e.key === 'Escape') closeMenu();
          }} />
      )}
      {filtered ? (
        filtered.length ? filtered.map(({ item, path }, i) => (
          <button key={i} type="button" className={cx('menu-item', i === active && 'active', item.danger && 'danger')} disabled={item.disabled} onMouseEnter={() => setActive(i)} onClick={() => run(item)}>
            <span className="menu-icon">{item.icon && <Icon name={item.icon} size={15} />}</span>
            <span className="menu-label"><span className="menu-path">{path}</span>{item.label}</span>
          </button>
        )) : <div className="menu-empty">—</div>
      ) : <MenuItems items={s.items} run={run} />}
    </div>
  );
}

function MenuItems({ items, run }: { items: MenuItem[]; run: (it: MenuItem) => void }) {
  const [sub, setSub] = useState<{ i: number; top: number } | null>(null);
  return (
    <>
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="menu-sep" />;
        if (it.header) return <div key={i} className="menu-header">{it.label}</div>;
        return (
          <div key={i} className="menu-row" onMouseEnter={(e) => setSub(it.submenu ? { i, top: (e.currentTarget as HTMLElement).offsetTop } : null)}>
            <button type="button" role="menuitem" className={cx('menu-item', it.danger && 'danger', sub?.i === i && 'open')} disabled={it.disabled}
              onClick={() => (it.submenu ? setSub({ i, top: 0 }) : run(it))} title={it.hint}>
              <span className="menu-icon">{it.checked ? <Icon name="check" size={15} /> : it.icon && <Icon name={it.icon} size={15} />}</span>
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
              {it.submenu && <Icon name="chevronRight" size={14} className="menu-sub-caret" />}
            </button>
            {it.submenu && sub?.i === i && (
              <div className="menu submenu" style={{ top: sub.top - 4 }}>
                <MenuItems items={it.submenu} run={run} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
