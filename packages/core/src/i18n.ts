import { formatString } from './util';

export type Locale = 'en' | 'zh-CN' | string;
export type Dictionary = Record<string, string>;

/**
 * Localisation store shared by the editor, runtime and modules. Text is kept in
 * dictionaries outside application logic; modules add their own dictionaries
 * under their module id (keys are looked up as given, so modules should prefix
 * keys with their id).
 */
export class I18n {
  private dicts = new Map<string, Dictionary>();
  private listeners = new Set<() => void>();
  locale: Locale;
  readonly fallback: Locale = 'en';

  constructor(locale: Locale = 'en') {
    this.locale = locale;
  }

  add(locale: Locale, dict: Dictionary): void {
    const cur = this.dicts.get(locale) || {};
    this.dicts.set(locale, { ...cur, ...dict });
    this.notify();
  }

  setLocale(locale: Locale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    this.notify();
  }

  has(key: string): boolean {
    return !!(this.dicts.get(this.locale)?.[key] ?? this.dicts.get(this.fallback)?.[key]);
  }

  /** Translate a key. Unknown keys are returned unchanged so plain labels work too. */
  t = (key: string, params?: Record<string, string | number>): string => {
    if (!key) return '';
    const s = this.dicts.get(this.locale)?.[key] ?? this.dicts.get(this.fallback)?.[key] ?? key;
    return formatString(s, params);
  };

  /** Resolve a manifest-style localised value: either a string or { en, "zh-CN" }. */
  pick(value: string | Record<string, string> | undefined | null): string {
    if (!value) return '';
    if (typeof value === 'string') return this.t(value);
    return value[this.locale] ?? value[this.fallback] ?? Object.values(value)[0] ?? '';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
