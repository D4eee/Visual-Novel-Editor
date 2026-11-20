import { useEffect, useState } from 'react';
import { useStore, useT } from '../state/store';
import { call } from '../host';
import { Button, IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';

interface Recent { path: string; name: string; opened: string }
interface Example { id: string; name: string; description: string; path: string }

export function Home() {
  const st = useStore();
  const t = useT();
  const [recent, setRecent] = useState<Recent[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  useEffect(() => {
    call('recent.list').then(setRecent).catch(() => {});
    call('examples.list').then(setExamples).catch(() => {});
  }, [st.sessions.length]);

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
              <div key={r.path} className="recent-row">
                <button type="button" className="recent" onClick={() => st.openProject(r.path)}>
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
            {!examples.length && <div className="muted small">{t('home.noExamples')}</div>}
            {examples.map((e) => (
              <div key={e.id} className="example-card">
                <div><b>{e.name}</b><div className="muted small">{e.description}</div></div>
                <div className="row-inline">
                  <Button small icon="duplicate" onClick={() => st.open({ kind: 'newProject', ...( { template: e.path, name: e.name } as any) })}>{t('home.useExample')}</Button>
                  <Button small kind="ghost" icon="folderOpen" onClick={() => st.openProject(e.path)} title={t('home.openExampleHint')}>{t('home.openExample')}</Button>
                </div>
              </div>
            ))}
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
