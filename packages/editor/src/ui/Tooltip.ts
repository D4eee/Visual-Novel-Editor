/**
 * Delayed tooltips for the whole editor.
 *
 * Any element with a `title` (or `data-tip`) shows its text in a styled tooltip
 * after the pointer rests on it for 1.5 s (`data-tip-delay` overrides the delay
 * in milliseconds). Native browser tooltips are suppressed so hints never pop up
 * immediately or twice; explanations stay out of the layout until asked for.
 */
const DEFAULT_DELAY = 1500;

export function installTooltips(): () => void {
  let timer = 0;
  let current: HTMLElement | null = null;
  const box = document.createElement('div');
  box.className = 'vne-tooltip';
  box.setAttribute('role', 'tooltip');
  document.body.append(box);

  const hide = () => {
    clearTimeout(timer);
    timer = 0;
    current = null;
    box.classList.remove('show');
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || !el.isConnected) return;
    box.textContent = text;
    box.classList.add('show');
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    let x = r.left + r.width / 2 - b.width / 2;
    let y = r.bottom + 8;
    if (y + b.height > window.innerHeight - 8) y = r.top - b.height - 8;
    x = Math.max(8, Math.min(window.innerWidth - b.width - 8, x));
    box.style.left = `${Math.round(x)}px`;
    box.style.top = `${Math.round(Math.max(8, y))}px`;
  };

  const over = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
    if (el === current) return;
    hide();
    if (!el) return;
    // Take over the native tooltip.
    const title = el.getAttribute('title');
    if (title !== null) {
      if (title) el.dataset.tip = title;
      el.removeAttribute('title');
      if (title && !el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
    }
    if (!el.dataset.tip) return;
    current = el;
    const delay = Number(el.dataset.tipDelay) || DEFAULT_DELAY;
    timer = window.setTimeout(() => show(el), delay);
  };

  const out = (e: PointerEvent) => {
    if (!current) return;
    const to = e.relatedTarget as Node | null;
    if (to && current.contains(to)) return;
    hide();
  };

  document.addEventListener('pointerover', over, true);
  document.addEventListener('pointerout', out, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  return () => {
    document.removeEventListener('pointerover', over, true);
    document.removeEventListener('pointerout', out, true);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('keydown', hide, true);
    document.removeEventListener('wheel', hide, true);
    window.removeEventListener('blur', hide);
    box.remove();
  };
}
