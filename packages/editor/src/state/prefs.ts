/**
 * Editor preferences: how the editor looks and behaves on this computer (not saved in projects).
 * Kept in localStorage and applied as CSS variables on the document root.
 */
import { useSyncExternalStore } from 'react';

export type ThemeName = 'dark' | 'midnight' | 'dim' | 'warm';

export interface EditorPrefs {
  theme: ThemeName;
  /** Custom background color; overrides the theme's when set. */
  background: string | null;
  accent: string;
  /** Text size factor (1 = 13 px body text). */
  fontScale: number;
  /** Whole-interface zoom (1 = 100 %). */
  zoom: number;
  /** Interface font ('' = system). */
  uiFont: string;
  /** Behind the stage on the scene canvas. */
  canvasBackdrop: 'checker' | 'dark' | 'light' | 'custom';
  canvasColor: string;
  reduceMotion: boolean;
  /** Save the project file automatically while editing. */
  autoSave: boolean;
  autoSaveSeconds: number;
  undoLimit: number;
  /** Ease of keyframes made from the inspector, canvas and presets. */
  defaultEase: string;
  /** Timeline clock: seconds (1.25 s) or frames (00:01:08 at the fps below). */
  timeDisplay: 'seconds' | 'frames';
  fps: number;
  snap: boolean;
  /** Draw audio waveforms in timeline media bars. */
  timelineWaveforms: boolean;
  /** What the AI assistant may do: change the project, or only read it and answer. */
  aiMode: 'edit' | 'read';
}

export const DEFAULT_PREFS: EditorPrefs = {
  theme: 'dark', background: null, accent: '#7d8bff', fontScale: 1, zoom: 1, uiFont: '',
  canvasBackdrop: 'checker', canvasColor: '#2a2d39', reduceMotion: false,
  autoSave: false, autoSaveSeconds: 60, undoLimit: 300, defaultEase: 'easeInOut', timeDisplay: 'seconds', fps: 30, snap: true,
  timelineWaveforms: true, aiMode: 'edit',
};

export const THEMES: Record<ThemeName, { bg: string; label: string }> = {
  dark: { bg: '#121318', label: 'prefs.theme.dark' },
  midnight: { bg: '#0b0c10', label: 'prefs.theme.midnight' },
  dim: { bg: '#1b1d24', label: 'prefs.theme.dim' },
  warm: { bg: '#16130f', label: 'prefs.theme.warm' },
};

export const ACCENTS = ['#7d8bff', '#4ea8ff', '#2ec4b6', '#3ecf8e', '#f2a541', '#ef6f6c', '#e06bd6', '#b58cff'];

const KEY = 'vne.editor.prefs';
let prefs: EditorPrefs = load();
const listeners = new Set<() => void>();

function load(): EditorPrefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch { return { ...DEFAULT_PREFS }; }
}

export function getPrefs(): EditorPrefs { return prefs; }

export function setPrefs(patch: Partial<EditorPrefs>): void {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  applyPrefs(prefs);
  for (const l of listeners) l();
}

export function resetPrefs(): void { setPrefs({ ...DEFAULT_PREFS }); }

export function usePrefs(): EditorPrefs {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => prefs);
}

/* ------------------------------------------------------------------ */
/* Colors                                                               */
/* ------------------------------------------------------------------ */

function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Mix toward white (amount > 0) or black (amount < 0). */
function shade(c: string, amount: number): string {
  const rgb = parseHex(c) || [18, 19, 24];
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  return hex(rgb[0] + (target - rgb[0]) * a, rgb[1] + (target - rgb[1]) * a, rgb[2] + (target - rgb[2]) * a);
}
const rgba = (c: string, a: number) => { const rgb = parseHex(c) || [125, 139, 255]; return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`; };
export const luminance = (c: string) => { const rgb = parseHex(c) || [0, 0, 0]; return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; };

/** Write the preferences into CSS variables (and the window zoom on desktop). */
export function applyPrefs(p: EditorPrefs = prefs): void {
  const root = document.documentElement;
  const bg = p.background && parseHex(p.background) ? p.background : THEMES[p.theme]?.bg || THEMES.dark.bg;
  // Backgrounds darker than the default theme are lifted a little so panels stay apart from it.
  const lum = luminance(bg);
  const step = lum > 0.35 ? -1 : 1; // very light custom colors: panels go darker instead
  const vars: Record<string, string> = {
    '--bg': bg,
    '--bg-2': shade(bg, step * 0.025),
    '--panel': shade(bg, step * 0.045),
    '--panel-2': shade(bg, step * 0.07),
    '--panel-3': shade(bg, step * 0.1),
    '--line': shade(bg, step * 0.09),
    '--line-2': shade(bg, step * 0.15),
    '--accent': p.accent,
    '--accent-2': shade(p.accent, -0.15),
    '--accent-soft': rgba(p.accent, 0.16),
    '--fs': String(Math.max(0.8, Math.min(1.4, p.fontScale || 1))),
    '--canvas-backdrop': p.canvasBackdrop === 'dark' ? '#0d0e12' : p.canvasBackdrop === 'light' ? '#d9dbe3' : p.canvasBackdrop === 'custom' ? p.canvasColor : '',
  };
  if (lum > 0.35) Object.assign(vars, { '--text': '#1d1f27', '--text-2': '#3c4050', '--muted': '#6b7083' });
  else for (const k of ['--text', '--text-2', '--muted']) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) { if (v) root.style.setProperty(k, v); else root.style.removeProperty(k); }
  if (p.uiFont) root.style.setProperty('--font', `${p.uiFont}, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`);
  else root.style.removeProperty('--font');
  root.classList.toggle('reduce-motion', !!p.reduceMotion);
  root.classList.toggle('canvas-backdrop-custom', p.canvasBackdrop !== 'checker');
  root.style.colorScheme = lum > 0.35 ? 'light' : 'dark';
  const z = Math.max(0.7, Math.min(1.6, p.zoom || 1));
  if (window.vneHost?.setZoom) { window.vneHost.setZoom(z).catch(() => {}); (root.style as any).zoom = ''; }
  else (root.style as any).zoom = z === 1 ? '' : String(z);
}
