import { useState } from 'react';
import { moduleKind, ownerOfType, usedTypeIds } from '@vne/core';
import type { ProjectSession, InstalledModuleInfo } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { call, isElectron } from '../host';
import { Modal } from '../ui/Modal';
import { Button, IconButton, Toggle, TextInput, cx, Empty } from '../ui/controls';
import { Icon } from '../ui/Icon';

/** Install, enable, configure and inspect modules. Works fully offline from local packages. */
export function ModuleManager({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const [selected, setSelected] = useState<string | null>(session.project.modules[0]?.id || session.installed[0]?.manifest.id || null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState('');
  const project = session.project;
  const deps = project.modules;
  const usedOwners = new Set<string>();
  for (const set of Object.values(usedTypeIds(project))) for (const x of set) { const o = ownerOfType(x); if (o) usedOwners.add(o); }

  const reload = async () => { setBusy(true); try { await session.loadModules(); } finally { setBusy(false); } };

  const install = async (source: string, scope: 'project' | 'library') => {
    if (!source) return;
    setBusy(true);
    try {
      const r = await call('modules.install', { source, scope, path: session.path });
      store.toast(t('modules.installed', { name: session.i18n.pick(r.manifest.name), version: r.manifest.version }), 'success');
      if (r.problems?.length) store.toast(r.problems.join('\n'), 'error');
      // Switch it on for this project straight away (an undoable change).
      if (r.compatible !== false) session.update(t('modules.enable'), (d) => {
        const dep = d.modules.find((x) => x.id === r.manifest.id);
        if (dep) dep.enabled = true; else d.modules.push({ id: r.manifest.id, version: `^${r.manifest.version}`, enabled: true });
      });
      await session.loadModules();
      setSelected(r.manifest.id);
    } catch (err: any) {
      store.toast(t('modules.installFailed', { error: err?.message || String(err) }), 'error');
    } finally { setBusy(false); }
  };

  const pickPackage = async () => {
    if (isElectron()) {
      const files = await store.pickFiles(t('modules.pickPackage'), [{ name: t('modules.package'), extensions: ['vnemod', 'zip', 'json'] }]);
      if (files[0]) await install(files[0].endsWith('module.json') ? files[0].replace(/[\\/]module\.json$/, '') : files[0], 'project');
    } else {
      const p = await store.pickFolder(t('modules.pickFolder'));
      if (p) await install(p, 'project');
    }
  };

  const addToProject = async (m: InstalledModuleInfo) => {
    setBusy(true);
    try {
      if (m.scope === 'library') await call('modules.copyToProject', { id: m.manifest.id, path: session.path });
      session.update(t('modules.enable'), (d) => { if (!d.modules.some((x) => x.id === m.manifest.id)) d.modules.push({ id: m.manifest.id, version: `^${m.manifest.version}`, enabled: true }); else d.modules.find((x) => x.id === m.manifest.id)!.enabled = true; });
      await session.loadModules();
      store.toast(t('modules.added', { name: session.i18n.pick(m.manifest.name as any) }), 'success');
    } catch (err: any) { store.toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    session.update(enabled ? t('modules.enable') : t('modules.disable'), (d) => { const x = d.modules.find((m) => m.id === id); if (x) x.enabled = enabled; });
    await reload();
  };

  const removeFromProject = async (id: string) => {
    const used = usedOwners.has(id);
    const ok = await store.confirm(t('modules.removeTitle'), used ? t('modules.removeUsed', { id }) : t('modules.removeConfirm', { id }), t('common.remove'), used);
    if (!ok) return;
    session.update(t('modules.remove'), (d) => { d.modules = d.modules.filter((m) => m.id !== id); });
    await reload();
  };

  const uninstall = async (m: InstalledModuleInfo) => {
    const ok = await store.confirm(t('modules.uninstallTitle'), t('modules.uninstallConfirm', { id: m.manifest.id, scope: t(`modules.scope.${m.scope}`) }), t('modules.uninstall'), true);
    if (!ok) return;
    try { await call('modules.remove', { id: m.manifest.id, scope: m.scope, path: session.path }); await reload(); }
    catch (err: any) { store.toast(err.message, 'error'); }
  };

  const ids = [...new Set([...deps.map((d) => d.id), ...session.installed.map((m) => m.manifest.id)])];
  const info = (id: string) => ({ dep: deps.find((d) => d.id === id), inst: session.installed.find((m) => m.manifest.id === id), rec: session.moduleRecords.find((r) => r.manifest.id === id) });
  const statusOf = (id: string) => {
    const { dep, inst, rec } = info(id);
    if (!inst) return { key: 'missing', cls: 'err' };
    if (!inst.compatible) return { key: 'incompatible', cls: 'err' };
    if (!dep) return { key: 'available', cls: 'muted' };
    if (!dep.enabled) return { key: 'disabled', cls: 'muted' };
    if (rec?.status === 'active') return { key: 'active', cls: 'ok' };
    return { key: rec?.status || 'failed', cls: 'err' };
  };
  const sel = selected ? info(selected) : null;
  const m = sel?.inst?.manifest || (sel?.rec?.manifest ?? null);
  const errors = session.moduleErrors.filter((e) => e.moduleId === selected);

  return (
    <Modal title={t('modules.managerTitle')} onClose={onClose} width={900} icon={<Icon name="module" size={18} />} className="module-manager"
      footer={<><span className="muted small">{t('modules.offlineNote')}</span><div className="grow" /><Button onClick={onClose}>{t('common.done')}</Button></>}>
      <div className="mm">
        <div className="mm-list">
          <div className="mm-install">
            <Button kind="primary" icon="upload" onClick={pickPackage} disabled={busy}>{t('modules.installFromFile')}</Button>
            {!isElectron() && (
              <div className="row-inline">
                <TextInput value={path} onChange={setPath} placeholder={t('modules.pathPlaceholder')} />
                <Button small onClick={() => install(path, 'project')} disabled={!path || busy}>{t('modules.install')}</Button>
              </div>
            )}
          </div>
          <div className="side-head"><span>{t('modules.inProject')}</span></div>
          {deps.map((d) => <ModRow key={d.id} id={d.id} session={session} active={selected === d.id} status={statusOf(d.id)} onClick={() => setSelected(d.id)} />)}
          {!deps.length && <div className="muted small pad">{t('modules.noneInProject')}</div>}
          <div className="side-head"><span>{t('modules.available')}</span></div>
          {ids.filter((id) => !deps.some((d) => d.id === id)).map((id) => <ModRow key={id} id={id} session={session} active={selected === id} status={statusOf(id)} onClick={() => setSelected(id)} />)}
        </div>
        <div className="mm-detail">
          {!selected || !sel ? <Empty icon="module" title={t('modules.selectOne')} /> : (
            <>
              <div className="mm-title">
                <Icon name="module" size={22} />
                <div>
                  <h3>{m ? session.i18n.pick(m.name as any) : selected}</h3>
                  <div className="muted small">{selected}{m ? ` · v${m.version}` : ''}{m?.author ? ` · ${typeof m.author === 'string' ? m.author : m.author.name}` : ''}</div>
                </div>
                <div className="grow" />
                {sel.dep && <Toggle value={sel.dep.enabled} onChange={(v) => setEnabled(selected, v)} label={t('modules.enabled')} />}
              </div>
              <div className={cx('status-line', statusOf(selected).cls)}><Icon name={statusOf(selected).cls === 'ok' ? 'check' : statusOf(selected).cls === 'err' ? 'error' : 'info'} size={14} />{t(`modules.status.${statusOf(selected).key}`)}{sel.rec?.error ? ` — ${sel.rec.error}` : ''}</div>
              {m?.description && <p>{session.i18n.pick(m.description as any)}</p>}
              {m && (
                <dl className="meta wide">
                  <dt>{t('modules.kind')}</dt><dd>{t(`modules.kind.${moduleKind(m)}`)}</dd>
                  <dt>{t('modules.engineRange')}</dt><dd><code>{m.engine}</code>{m.api ? <> · API <code>{m.api}</code></> : null}</dd>
                  <dt>{t('modules.location')}</dt><dd>{sel.inst ? `${t(`modules.scope.${sel.inst.scope}`)} — ${sel.inst.dir}` : '—'}</dd>
                  <dt>{t('modules.dependencies')}</dt><dd>{Object.entries(m.dependencies || {}).map(([k, v]) => { const ok = session.moduleRecords.find((r) => r.manifest.id === k)?.status === 'active'; return <span key={k} className={cx('dep', ok ? 'ok' : 'bad')}>{k} {v}</span>; })}{!Object.keys(m.dependencies || {}).length && '—'}</dd>
                  <dt>{t('modules.permissions')}</dt><dd>{(m.permissions || []).map((p) => <span key={p} className="dep">{t(`perm.${p}`)}</span>)}{!(m.permissions || []).length && t('modules.noPermissions')}</dd>
                  <dt>{t('modules.provides')}</dt><dd className="provides">{Object.entries(m.provides || {}).filter(([, v]) => v?.length).map(([k, v]) => <div key={k}><b>{t(`provides.${k}`)}</b> {v!.join(', ')}</div>)}{!Object.keys(m.provides || {}).length && '—'}</dd>
                </dl>
              )}
              {sel.inst?.problems.length ? <div className="issue error"><Icon name="error" size={14} />{sel.inst.problems.join('; ')}</div> : null}
              {errors.length > 0 && <div className="mm-errors"><div className="row-label">{t('modules.recentErrors')}</div>{errors.slice(-5).map((e, i) => <div key={i} className="issue error slim"><Icon name="error" size={13} />{e.where}: {e.message}</div>)}</div>}
              {usedOwners.has(selected) && <div className="muted small"><Icon name="info" size={12} /> {t('modules.usedByProject')}</div>}
              <div className="row-inline mm-actions">
                {!sel.dep && sel.inst && sel.inst.compatible && <Button kind="primary" icon="plus" onClick={() => addToProject(sel.inst!)} disabled={busy}>{t('modules.addToProject')}</Button>}
                {sel.dep && <Button icon="minus" onClick={() => removeFromProject(selected)}>{t('modules.removeFromProject')}</Button>}
                {sel.inst && <Button icon="trash" kind="ghost" onClick={() => uninstall(sel.inst!)}>{t('modules.uninstall')}</Button>}
                <Button icon="refresh" kind="ghost" onClick={reload} disabled={busy}>{t('modules.reload')}</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ModRow({ id, session, active, status, onClick }: { id: string; session: ProjectSession; active: boolean; status: { key: string; cls: string }; onClick: () => void }) {
  const t = useT();
  const inst = session.installed.find((m) => m.manifest.id === id);
  return (
    <button type="button" className={cx('mm-row', active && 'active')} onClick={onClick}>
      <Icon name="module" size={14} />
      <span className="mm-name">{inst ? session.i18n.pick(inst.manifest.name as any) : id}</span>
      <span className={cx('mm-status', status.cls)}>{t(`modules.status.${status.key}`)}</span>
    </button>
  );
}

export { IconButton };
