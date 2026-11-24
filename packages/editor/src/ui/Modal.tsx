import { ReactNode, useEffect, useRef } from 'react';
import { IconButton, cx } from './controls';

export function Modal({ title, children, onClose, footer, width = 560, className, icon }: { title: ReactNode; children: ReactNode; onClose: () => void; footer?: ReactNode; width?: number; className?: string; icon?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal-close)');
    first?.focus();
    // Only the topmost window answers keys (a confirm can open over another window).
    const isTop = () => { const all = document.querySelectorAll('.modal'); return all[all.length - 1] === el; };
    const key = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', className)} style={{ width }} ref={ref} role="dialog" aria-modal="true">
        <header className="modal-head">
          {icon}
          <h2>{title}</h2>
          <IconButton icon="close" title="Close" onClick={onClose} className="modal-close" />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
