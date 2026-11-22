/**
 * Translations: make a game multi-language. Choose the language the story is written in and
 * the languages to offer, then translate every text players see in a table — by hand, with the
 * AI assistant's model (batch "translate missing"), or in a spreadsheet (CSV out and back in).
 */
import { useMemo, useRef, useState } from 'react';
import type { Localization, TextEntry } from '@vne/core';
import { LANGUAGES, collectTexts, csvTranslations, languageName, translationOf, translationsToCsv } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { store, useSession, useT } from '../state/store';
import { call } from '../host';
import { Modal } from '../ui/Modal';
import { Button, Empty, IconButton, Select, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenuBelow } from '../ui/Menu';

const PAGE = 60;
type Filter = 'all' | 'missing' | 'outdated' | 'done';

export function TranslationsDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const loc = session.project.localization as Localization | undefined;
  return (
    <Modal title={t('l10n.title')} onClose={onClose} width={1080} icon={<Icon name="languages" size={18} />} className="l10n-modal" footer={<><span className="grow" /><Button kind="primary" onClick={onClose}>{t('common.done')}</Button></>}>
      {loc ? <Table session={session} loc={loc} /> : <Setup session={session} />}
    </Modal>
  );
}

/** First step: the story's language and the languages to add. */
function Setup({ session }: { session: ProjectSession }) {
  const t = useT();
  const [source, setSource] = useState(session.i18n.locale === 'zh-CN' ? 'zh-CN' : 'en');
  const [langs, setLangs] = useState<string[]>([source === 'en' ? 'zh-CN' : 'en']);
  return (
    <div className="l10n-setup">
      <Empty icon="languages" title={t('l10n.setupTitle')}>{t('l10n.setupText')}</Empty>
      <div className="l10n-setup-form">
        <label>{t('l10n.sourceLanguage')}</label>
        <Select value={source} options={LANGUAGES.map((l) => ({ value: l.code, label: `${l.name} · ${l.english}` }))} onChange={(v) => { setSource(v); setLangs(langs.filter((x) => x !== v)); }} />
        <label>{t('l10n.offerIn')}</label>
        <div className="chip-wrap">
          {LANGUAGES.filter((l) => l.code !== source).map((l) => (
            <button key={l.code} type="button" className={cx('chip-btn', langs.includes(l.code) && 'on')} onClick={() => setLangs(langs.includes(l.code) ? langs.filter((x) => x !== l.code) : [...langs, l.code])}>
              {langs.includes(l.code) && <Icon name="check" size={12} />}{l.name}
            </button>
          ))}
        </div>
        <div><Button kind="primary" icon="languages" disabled={!langs.length} onClick={() => session.update(t('l10n.start'), (d) => { d.localization = { source, languages: langs, strings: Object.fromEntries(langs.map((l) => [l, {}])) }; })}>{t('l10n.start')}</Button></div>
      </div>
    </div>
  );
}

function Table({ session, loc }: { session: ProjectSession; loc: Localization }) {
  const t = useT();
  const [lang, setLang] = useState(loc.languages[0] || '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [job, setJob] = useState<{ done: number; total: number; cancel: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const texts = useMemo(() => collectTexts(session.engine, session.project), [session.project]);
  const current = loc.languages.includes(lang) ? lang : loc.languages[0];

  const stateOf = (e: TextEntry, l = current) => {
    const tr = translationOf(session.project, l, e.key);
    return !tr ? 'missing' : tr.s != null && tr.s !== e.text ? 'outdated' : 'done';
  };
  const counts = (l: string) => { let done = 0, outdated = 0; for (const e of texts) { const s = stateOf(e, l); if (s !== 'missing') done++; if (s === 'outdated') outdated++; } return { done, outdated }; };
  const q = query.trim().toLowerCase();
  const rows = texts.filter((e) => (filter === 'all' || stateOf(e) === filter) && (!q || e.text.toLowerCase().includes(q) || e.nodeName.toLowerCase().includes(q) || e.label.toLowerCase().includes(q) || (translationOf(session.project, current, e.key)?.t || '').toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = rows.slice(pg * PAGE, pg * PAGE + PAGE);

  const write = (entries: Record<string, { t: string; s: string }>, label: string, mergeKey?: string) => session.update(label, (d) => {
    const l = d.localization!;
    const table = (l.strings[current] = l.strings[current] || {});
    for (const [k, v] of Object.entries(entries)) { if (v.t.trim()) table[k] = { t: v.t, s: v.s }; else delete table[k]; }
  }, mergeKey ? { mergeKey } : undefined);

  const addLanguage = (e: React.MouseEvent) => openMenuBelow(e.currentTarget as HTMLElement, LANGUAGES.filter((l) => l.code !== loc.source && !loc.languages.includes(l.code)).map((l) => ({
    label: `${l.name} · ${l.english}`, onClick: () => { session.update(t('l10n.addLanguage'), (d) => { d.localization!.languages.push(l.code); d.localization!.strings[l.code] = d.localization!.strings[l.code] || {}; }); setLang(l.code); },
  })), { search: true });
  const moreMenu = (e: React.MouseEvent) => openMenuBelow(e.currentTarget as HTMLElement, [
    { header: true, label: t('l10n.sourceLanguage') },
    ...LANGUAGES.filter((l) => !loc.languages.includes(l.code)).map((l) => ({ label: l.name, checked: l.code === loc.source, onClick: () => session.update(t('l10n.sourceLanguage'), (d) => { d.localization!.source = l.code; }) })),
    { separator: true },
    { label: t('l10n.removeLanguage', { name: languageName(current) }), icon: 'trash', danger: true, disabled: !current, onClick: async () => {
      if (!(await store.confirm(t('l10n.removeLanguage', { name: languageName(current) }), t('l10n.removeLanguageText', { name: languageName(current), n: counts(current).done }), t('common.delete'), true))) return;
      session.update(t('l10n.removeLanguage', { name: languageName(current) }), (d) => { const l = d.localization!; l.languages = l.languages.filter((x) => x !== current); delete l.strings[current]; if (!l.languages.length) delete d.localization; });
      setLang('');
    } },
  ]);

  const exportCsv = () => {
    const blob = new Blob([translationsToCsv(texts, session.project, current)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${session.project.name}-${current}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importCsv = async (file: File) => {
    try {
      const map = csvTranslations(await file.text(), current);
      const src = new Map(texts.map((e) => [e.key, e.text]));
      const entries: Record<string, { t: string; s: string }> = {};
      let n = 0;
      for (const [k, v] of Object.entries(map)) if (src.has(k)) { entries[k] = { t: v, s: src.get(k)! }; if (v.trim()) n++; }
      write(entries, t('l10n.importCsv'));
      store.toast(t('l10n.imported', { n }), 'success');
    } catch (e: any) { store.toast(`${t('l10n.importFailed')}: ${e?.message || e}`, 'error'); }
  };

  /** Translate missing (or outdated) texts with the AI assistant's model, in batches. */
  const aiTranslate = async () => {
    const todo = texts.filter((e) => stateOf(e) !== 'done');
    if (!todo.length) return;
    const ctl = { done: 0, total: todo.length, cancel: false };
    setJob({ ...ctl });
    const from = LANGUAGES.find((l) => l.code === loc.source)?.english || loc.source;
    const to = LANGUAGES.find((l) => l.code === current)?.english || current;
    const glossary = session.project.characters.map((c) => { const tr = translationOf(session.project, current, `char:${c.id}`); return tr ? `${c.name} = ${tr.t}` : null; }).filter(Boolean).join('; ');
    const system = [
      `You translate a visual novel from ${from} to ${to}.`,
      'Translate naturally for the characters and the scene; keep the tone. Keep {variables}, [tags], <tags>, line breaks and leading/trailing spaces exactly.',
      glossary ? `Use these names: ${glossary}.` : '',
      'Answer with JSON only: an object mapping each "i" to its translation, e.g. {"0":"…","1":"…"}.',
    ].filter(Boolean).join('\n');
    try {
      for (let i = 0; i < todo.length && !ctl.cancel; i += 30) {
        const batch = todo.slice(i, i + 30);
        const payload = batch.map((e, j) => ({ i: String(j), text: e.text, ...(e.kind === 'line' && e.label ? { speaker: e.label } : {}), ...(e.kind !== 'line' ? { kind: e.kind } : {}), ...(e.nodeName ? { scene: e.nodeName } : {}) }));
        const res = await call('ai.chat', { system, messages: [{ role: 'user', content: JSON.stringify(payload) }], maxTokens: 8000 });
        const text = (res?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const json = JSON.parse(text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1'));
        const entries: Record<string, { t: string; s: string }> = {};
        batch.forEach((e, j) => { const v = json[String(j)]; if (typeof v === 'string' && v.trim()) entries[e.key] = { t: v, s: e.text }; });
        write(entries, t('l10n.aiTranslation'));
        ctl.done = Math.min(todo.length, i + batch.length);
        setJob({ ...ctl });
      }
      store.toast(ctl.cancel ? t('l10n.aiStopped', { n: ctl.done }) : t('l10n.aiDone', { n: ctl.done }), 'success');
    } catch (e: any) {
      const msg = String(e?.message || e);
      store.toast(/NO_KEY|NO_MODEL/.test(msg) ? t('ai.noKey') : `${t('l10n.aiFailed')}: ${msg}`, 'error');
    } finally { setJob(null); }
  };

  const c = current ? counts(current) : { done: 0, outdated: 0 };
  return (
    <div className="l10n">
      <div className="l10n-langs">
        <span className="l10n-source" title={t('l10n.sourceLanguage')}><Icon name="text" size={13} />{languageName(loc.source)}</span>
        <Icon name="arrowRight" size={13} className="muted" />
        {loc.languages.map((l) => {
          const k = counts(l);
          const pct = texts.length ? Math.round((k.done / texts.length) * 100) : 100;
          return (
            <button key={l} type="button" className={cx('l10n-lang', l === current && 'active')} onClick={() => { setLang(l); setPage(0); }}>
              <span>{languageName(l)}</span>
              <span className="l10n-bar"><i style={{ width: `${pct}%` }} /></span>
              <span className="l10n-pct">{pct}%</span>
              {k.outdated > 0 && <span className="l10n-out" title={t('l10n.outdatedHint')}>{k.outdated}</span>}
            </button>
          );
        })}
        <Button small icon="plus" onClick={addLanguage}>{t('l10n.addLanguage')}</Button>
        <span className="grow" />
        <IconButton icon="more" size={15} title={t('common.more')} onClick={moreMenu} />
      </div>
      <div className="l10n-tools">
        <input className="input" placeholder={t('l10n.search')} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} onKeyDown={(e) => e.stopPropagation()} />
        <Select value={filter} options={(['all', 'missing', 'outdated', 'done'] as Filter[]).map((f) => ({ value: f, label: t(`l10n.filter.${f}`) }))} onChange={(v) => { setFilter(v as Filter); setPage(0); }} />
        <span className="muted small">{t('l10n.count', { done: c.done, total: texts.length, outdated: c.outdated })}</span>
        <span className="grow" />
        {job ? (
          <span className="l10n-job"><span className="l10n-bar wide"><i style={{ width: `${(job.done / job.total) * 100}%` }} /></span>{job.done}/{job.total}<Button small kind="danger" onClick={() => setJob((j) => { if (j) j.cancel = true; return j ? { ...j } : j; })}>{t('ai.stop')}</Button></span>
        ) : (
          <Button small kind="primary" icon="sparkles" disabled={texts.length - c.done + c.outdated === 0} onClick={aiTranslate} title={t('l10n.aiHint')}>{t('l10n.aiTranslate', { n: texts.length - c.done + c.outdated })}</Button>
        )}
        <Button small icon="download" onClick={exportCsv} title={t('l10n.csvHint')}>CSV</Button>
        <Button small icon="upload" onClick={() => fileRef.current?.click()} title={t('l10n.importCsv')}>{t('l10n.import')}</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
      </div>
      <div className="l10n-table">
        <div className="l10n-row head"><span>{t('l10n.where')}</span><span>{languageName(loc.source)}</span><span>{languageName(current)}</span></div>
        {!shown.length && <div className="muted l10n-none">{t('l10n.nothing')}</div>}
        {shown.map((e) => <Row key={`${current}:${e.key}`} session={session} entry={e} lang={current} state={stateOf(e)} onWrite={(v) => write({ [e.key]: { t: v, s: e.text } }, t('l10n.edit'), `l10n-${current}-${e.key}`)} />)}
      </div>
      {pages > 1 && (
        <div className="l10n-pages">
          <IconButton icon="chevronLeft" title={t('common.previous')} size={14} disabled={pg === 0} onClick={() => setPage(pg - 1)} />
          <span>{pg + 1} / {pages}</span>
          <IconButton icon="chevronRight" title={t('common.next')} size={14} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} />
        </div>
      )}
    </div>
  );
}

function Row({ session, entry, lang, state, onWrite }: { session: ProjectSession; entry: TextEntry; lang: string; state: string; onWrite: (v: string) => void }) {
  const t = useT();
  const saved = translationOf(session.project, lang, entry.key)?.t || '';
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const kindIcon = entry.kind === 'line' ? 'chat' : entry.kind === 'character' ? 'user' : entry.kind === 'meta' ? 'book' : entry.kind === 'arg' ? 'module' : 'text';
  return (
    <div className={cx('l10n-row', state)}>
      <span className="l10n-where">
        <Icon name={kindIcon} size={12} />
        {entry.nodeId ? <button type="button" className="link" onClick={() => session.openNode(entry.nodeId!)} title={t('l10n.openScene')}>{entry.nodeName}</button> : <span>{entry.kind === 'meta' ? t(`l10n.meta.${entry.label}`) : entry.kind === 'character' ? t('l10n.character') : entry.nodeName}</span>}
        {entry.label && entry.kind !== 'meta' && entry.kind !== 'character' && <span className="muted"> · {entry.label}</span>}
        {state === 'outdated' && <span className="l10n-flag" title={t('l10n.outdatedHint')}>{t('l10n.filter.outdated')}</span>}
      </span>
      <span className="l10n-src">{entry.text}</span>
      <textarea className="l10n-tr" value={value} rows={Math.min(5, Math.max(1, Math.ceil(Math.max(value.length, entry.text.length) / 46), value.split('\n').length))} placeholder={t('l10n.placeholder')}
        onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== null && draft !== saved) onWrite(draft); setDraft(null); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); }} />
    </div>
  );
}
