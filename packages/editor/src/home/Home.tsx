import { useEffect, useRef, useState } from 'react';
import { useStore, useT, store } from '../state/store';
import { call } from '../host';
import { Button, IconButton, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu } from '../ui/Menu';

interface Recent { path: string; name: string; opened: string }
interface Example { id: string; name: string; description: string; descriptions?: Record<string, string>; path: string; iconUrl?: string | null; scenes?: number; chapters?: number }

const HOVER_INFO_MS = 2000;

/**
 * Examples as app icons in a scrollable box, three per row. Hovering an icon for two
 * seconds shows its details (like a folder of apps); click opens it.
 */
function ExampleShelf({ examples }: { examples: Example[] }) {
  const st = useStore();
  const t = useT();
  const [info, setInfo] = useState<{ id: string; x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const overCard = useRef(false);
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  const desc = (e: Example) => e.descriptions?.[st.i18n.locale] || e.description;
  const openExample = async (e: Example) => { setInfo(null); const r = await call('examples.workingCopy', { id: e.id }); st.openProject(r.path); };
  const copyExample = (e: Example) => { setInfo(null); st.open({ kind: 'newProject', ...({ template: e.path, name: e.name } as any) }); };
  const shown = examples.find((e) => e.id === info?.id);
  return (
    <div className="example-shelf" onScroll={() => setInfo(null)}>
      <div className="example-grid" role="list">
        {examples.map((e) => (
          <button key={e.id} type="button" role="listitem" className={cx('example-app', info?.id === e.id && 'active')}
            onClick={() => openExample(e)}
            onContextMenu={(ev) => { ev.preventDefault(); clear(); setInfo(null); openMenu(ev, [
              { label: t('home.openExample'), icon: 'folderOpen', onClick: () => openExample(e) },
              { label: t('home.useExample'), icon: 'duplicate', onClick: () => copyExample(e) },
            ]); }}
            onPointerEnter={(ev) => {
              clear();
              const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              timer.current = window.setTimeout(() => setInfo({ id: e.id, x: r.left + r.width / 2, y: r.bottom + 6 }), HOVER_INFO_MS);
            }}
            onPointerLeave={() => { clear(); window.setTimeout(() => { if (!overCard.current) setInfo((cur) => (cur?.id === e.id ? null : cur)); }, 120); }}
            onFocus={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setInfo({ id: e.id, x: r.left + r.width / 2, y: r.bottom + 6 }); }}
            aria-label={e.name}>
            <span className="example-icon">{e.iconUrl ? <img src={e.iconUrl} alt="" /> : <Icon name="book" size={30} />}</span>
            <span className="example-name">{e.name}</span>
          </button>
        ))}
      </div>
      {shown && info && (
        <div className="example-info" style={{ left: info.x, top: info.y }} role="dialog" aria-label={shown.name}
          onPointerEnter={() => { overCard.current = true; }}
          onPointerLeave={() => { overCard.current = false; setInfo(null); }}>
          <div className="example-info-head">
            <span className="example-icon small">{shown.iconUrl ? <img src={shown.iconUrl} alt="" /> : <Icon name="book" size={18} />}</span>
            <div><b>{shown.name}</b><div className="muted small">{t('home.exampleStats', { chapters: shown.chapters ?? 0, scenes: shown.scenes ?? 0 })}</div></div>
          </div>
          <p className="small">{desc(shown)}</p>
          <div className="row-inline">
            <Button small kind="primary" icon="folderOpen" onClick={() => openExample(shown)} title={st.info?.examplesReadOnly ? t('home.openExampleCopyHint') : t('home.openExampleHint')}>{t('home.openExample')}</Button>
            <Button small icon="duplicate" onClick={() => copyExample(shown)}>{t('home.useExample')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Home() {
  const st = useStore();
  const t = useT();
  const [recent, setRecent] = useState<Recent[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  useEffect(() => {
    call('recent.list').then(setRecent).catch(() => {});
    call('examples.list').then(setExamples).catch(() => {});
  }, [st.sessions.length]);

  const deleteProject = async (r: Recent) => {
    const where = st.info?.mode === 'electron' ? t('home.deleteToTrash') : t('home.deleteToFolder');
    if (!(await store.confirm(t('home.deleteTitle', { name: r.name }), t('home.deleteMessage', { path: r.path, where }), t('common.delete'), true))) return;
    // Close it first if it is open.
    const i = st.sessions.findIndex((s) => s.path === r.path);
    if (i >= 0) await st.closeSession(i);
    if (st.sessions.some((s) => s.path === r.path)) return; // closing was cancelled
    try {
      const res = await call('project.trash', { path: r.path });
      store.toast(res?.where === 'trash' ? t('home.deletedTrash', { name: r.name }) : t('home.deletedFolder', { name: r.name, path: res?.path || '' }), 'success');
    } catch (err: any) {
      store.toast(t('home.deleteFailed', { msg: err?.message || String(err) }), 'error');
    }
    setRecent(await call('recent.list'));
  };

  const open = async () => {
    const p = await st.pickProject(t('home.openTitle'));
    if (p) await st.openProject(p);
  };

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <div className="logo-mark"><Icon name="logo" size={30} /></div>
          <div>
            <h1>{t('app.name')}</h1>
            <p className="muted">{t('home.tagline')}</p>
          </div>
        </header>
        <div className="home-actions">
          <button type="button" className="big-action primary" onClick={() => st.open({ kind: 'newProject' })}>
            <Icon name="plus" size={22} /><b>{t('home.new')}</b><span>{t('home.newHint')}</span>
          </button>
          <button type="button" className="big-action" onClick={open}>
            <Icon name="folderOpen" size={22} /><b>{t('home.open')}</b><span>{t('home.openHint')}</span>
          </button>
        </div>
        <div className="home-cols">
          <section>
            <h2>{t('home.recent')}</h2>
            {!recent.length && <div className="muted small">{t('home.noRecent')}</div>}
            {recent.map((r) => (
              <div key={r.path} className="recent-row" onContextMenu={(e) => { e.preventDefault(); openMenu(e, [
                { label: t('home.openProject'), icon: 'folderOpen', onClick: () => st.openProject(r.path) },
                { label: t('home.reveal'), icon: 'folder', onClick: () => call('shell.reveal', { path: r.path }), disabled: st.info?.mode !== 'electron' },
                { label: t('home.removeRecent'), icon: 'close', onClick: async () => { await call('recent.remove', { path: r.path }); setRecent(await call('recent.list')); } },
                { separator: true },
                { label: t('home.deleteProject'), icon: 'trash', danger: true, onClick: () => deleteProject(r) },
              ]); }}>
                <button type="button" className="recent" onClick={() => st.openProject(r.path)} title={t('home.recentHint')}>
                  <Icon name="book" size={16} />
                  <span><b>{r.name}</b><span className="muted small">{r.path}</span></span>
                  <span className="muted small">{new Date(r.opened).toLocaleDateString()}</span>
                </button>
                <IconButton icon="close" size={13} title={t('home.removeRecent')} onClick={async () => { await call('recent.remove', { path: r.path }); setRecent(await call('recent.list')); }} />
              </div>
            ))}
          </section>
          <section>
            <h2>{t('home.examples')}</h2>
            {!examples.length ? <div className="muted small">{t('home.noExamples')}</div> : <ExampleShelf examples={examples} />}
            <div className="home-docs">
              <h2>{t('home.learn')}</h2>
              <a href="https://github.com/D4eee/Visual-Novel-Editor/blob/main/docs/user-guide/README.md" target="_blank" rel="noreferrer"><Icon name="book" size={14} /> {t('home.userGuide')}</a>
              <a href="https://github.com/D4eee/Visual-Novel-Editor/blob/main/docs/modding/README.md" target="_blank" rel="noreferrer"><Icon name="module" size={14} /> {t('home.modding')}</a>
            </div>
          </section>
        </div>
        <footer className="home-foot muted small">
          <span>{st.info?.mode === 'electron' ? t('home.desktop', { v: st.info.electronVersion }) : t('home.browserMode')}</span>
          <span className="grow" />
          <button type="button" className="link" onClick={() => st.setLocale(st.i18n.locale === 'zh-CN' ? 'en' : 'zh-CN')}><Icon name="globe" size={13} /> {st.i18n.locale === 'zh-CN' ? 'English' : '简体中文'}</button>
        </footer>
      </div>
    </div>
  );
}
