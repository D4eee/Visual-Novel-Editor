/**
 * First-run tour: a few tips pointing at the main parts of the editor. It starts the first
 * time a project is open, can be skipped, and can be replayed (command palette, F1 dialog,
 * home page).
 */
import { useEffect, useState } from 'react';
import { useStore, useT } from '../state/store';
import { Button } from './controls';
import { Icon } from './Icon';

const KEY = 'vne.tour.v1';
const listeners = new Set<(on: boolean) => void>();
export function startTour(): void { for (const l of listeners) l(true); }
export function tourSeen(): boolean { try { return localStorage.getItem(KEY) === 'done'; } catch { return true; } }

interface Step { target: string; title: string; text: string; place: 'right' | 'bottom' | 'left' | 'center' }

const STEPS: Step[] = [
  { target: '.ws-body', title: 'tour.graph.title', text: 'tour.graph.text', place: 'center' },
  { target: 'nav.activity', title: 'tour.side.title', text: 'tour.side.text', place: 'right' },
  { target: '.split-btn, .preview-stop', title: 'tour.preview.title', text: 'tour.preview.text', place: 'bottom' },
  { target: '.ai-toggle', title: 'tour.ai.title', text: 'tour.ai.text', place: 'bottom' },
  { target: '.export-btn', title: 'tour.export.title', text: 'tour.export.text', place: 'bottom' },
  { target: 'body', title: 'tour.palette.title', text: 'tour.palette.text', place: 'center' },
];

export function TourHost() {
  const st = useStore();
  const t = useT();
  const [on, setOn] = useState(false);
  const [i, setI] = useState(0);
  const [, force] = useState(0);
  useEffect(() => { const l = (v: boolean) => { setI(0); setOn(v); }; listeners.add(l); return () => { listeners.delete(l); }; }, []);
  // First time a project is open.
  useEffect(() => {
    if (!st.session || tourSeen()) return;
    const id = window.setTimeout(() => { if (!tourSeen()) { setI(0); setOn(true); } }, 900);
    return () => window.clearTimeout(id);
  }, [!!st.session]);
  useEffect(() => {
    if (!on) return;
    const r = () => force((x) => x + 1);
    window.addEventListener('resize', r);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('resize', r); window.removeEventListener('keydown', key); };
  }, [on]);
  const finish = () => { setOn(false); try { localStorage.setItem(KEY, 'done'); } catch { /* ignore */ } };
  if (!on || !st.session) return null;
  const step = STEPS[i];
  const el = step.target.split(',').map((s) => document.querySelector(s.trim()) as HTMLElement | null).find(Boolean);
  const r = el && step.place !== 'center' ? el.getBoundingClientRect() : null;
  const W = 320;
  let left = window.innerWidth / 2 - W / 2, top = window.innerHeight / 2 - 90;
  if (r && step.place === 'right') { left = r.right + 14; top = Math.max(12, r.top + 40); }
  if (r && step.place === 'bottom') { left = Math.min(window.innerWidth - W - 12, Math.max(12, r.left + r.width / 2 - W / 2)); top = r.bottom + 12; }
  if (r && step.place === 'left') { left = r.left - W - 14; top = Math.max(12, r.top); }
  const last = i === STEPS.length - 1;
  return (
    <div className="tour" role="dialog" aria-label={t('tour.title')}>
      {r ? <div className="tour-hole" style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} /> : <div className="tour-dim" />}
      <div className="tour-card" style={{ left, top, width: W }}>
        <div className="tour-step muted small">{t('tour.step', { n: i + 1, total: STEPS.length })}</div>
        <b>{t(step.title)}</b>
        <p>{t(step.text)}</p>
        <div className="tour-actions">
          <button type="button" className="link muted" onClick={finish}>{t('tour.skip')}</button>
          <span className="grow" />
          {i > 0 && <Button small onClick={() => setI(i - 1)}>{t('tour.back')}</Button>}
          <Button small kind="primary" onClick={() => (last ? finish() : setI(i + 1))}>{last ? t('tour.done') : t('tour.next')}{!last && <Icon name="chevronRight" size={13} />}</Button>
        </div>
      </div>
    </div>
  );
}
