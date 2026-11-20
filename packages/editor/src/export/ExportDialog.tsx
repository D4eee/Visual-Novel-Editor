import { useEffect, useMemo, useState } from 'react';
import { ownerOfType, usedTypeIds } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { call, joinPath, isElectron } from '../host';
import { Modal } from '../ui/Modal';
import { Button, Field, TextInput, NumberInput, Select, Toggle, Checkbox, Section, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { AssetPicker } from '../inspect/AssetPicker';
import { IssueList } from '../problems/Problems';
import { makeMountContext } from '../modules/editorApi';
import { serializeProject } from '@vne/core';

const TARGETS = [
  { id: 'mac-arm64', icon: 'apple', label: 'export.macArm' },
  { id: 'mac-x64', icon: 'apple', label: 'export.macIntel' },
  { id: 'win-x64', icon: 'windows', label: 'export.win' },
  { id: 'web', icon: 'web', label: 'export.web' },
];
const RES = [[1280, 720], [1920, 1080], [1600, 900], [1024, 768], [1080, 1920], [800, 600]];

async function renderIcons(url: string): Promise<Record<number, string>> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const out: Record<number, string> = {};
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d')!;
    const k = Math.max(s / img.naturalWidth, s / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
    out[s] = c.toDataURL('image/png').split(',')[1];
  }
  return out;
}

export function ExportDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSession(session);
  const t = useT();
  const s = session.project.settings;
  const [targets, setTargets] = useState<Set<string>>(() => {
    try { const v = JSON.parse(localStorage.getItem(`vne.export.targets.${session.project.id}`) || 'null'); if (Array.isArray(v)) return new Set(v); } catch { /* ignore */ }
    const plat = store.info?.platform;
    return new Set(plat === 'win32' ? ['win-x64'] : plat === 'darwin' ? [store.info?.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'] : ['web']);
  });
  const [outDir, setOutDir] = useState(() => localStorage.getItem(`vne.export.dir.${session.project.id}`) || joinPath(session.path, 'exports'));
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<{ outputs: { target: string; path: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Record<string, string | null>>({});
  useEffect(() => { call('export.templates').then(setTemplates).catch(() => {}); session.validate(); session.refreshMissingAssets(); }, []);
  const upd = (label: string, fn: (st: typeof s) => void) => session.update(label, (d) => fn(d.settings));

  const errors = session.issues.filter((i) => i.severity === 'error');
  const warnings = session.issues.filter((i) => i.severity === 'warning');
  const modulesUsed = useMemo(() => {
    const ids = new Set(session.project.modules.filter((m) => m.enabled).map((m) => m.id));
    for (const set of Object.values(usedTypeIds(session.project))) for (const x of set) { const o = ownerOfType(x); if (o) ids.add(o); }
    return [...ids].map((id) => ({ id, rec: session.moduleRecords.find((r) => r.manifest.id === id) }));
  }, [session.project]);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    setLogs([t('export.starting')]);
    try {
      localStorage.setItem(`vne.export.targets.${session.project.id}`, JSON.stringify([...targets]));
      localStorage.setItem(`vne.export.dir.${session.project.id}`, outDir);
      let icons: Record<number, string> | undefined;
      const iconAsset = session.project.assets.find((a) => a.id === s.iconAssetId);
      if (iconAsset) { try { icons = await renderIcons(session.assetUrl(iconAsset)); } catch (err: any) { setLogs((l) => [...l, `${t('export.iconFailed')}: ${err?.message || err}`]); } }
      const r = await call('export.run', { path: session.path, json: serializeProject(session.project), options: { outputDir: outDir, targets: [...targets], icons, zipWindows: true } });
      setLogs((l) => [...l, ...r.logs, t('export.done')]);
      setResult(r);
      store.toast(t('export.success'), 'success');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleTarget = (id: string) => { const n = new Set(targets); if (n.has(id)) n.delete(id); else n.add(id); setTargets(n); };
  const assetUrl = (id: string) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; };

  return (
    <Modal title={t('export.title')} onClose={busy ? () => {} : onClose} width={760} icon={<Icon name="export" size={18} />}
      footer={<>
        <span className={cx('muted small', result && 'ok')}>{busy ? t('export.exporting') : result ? t('export.success') : errors.length ? t('export.blocked', { n: errors.length }) : warnings.length ? t('export.warnings', { n: warnings.length }) : t('export.ready')}</span>
        <div className="grow" />
        <Button onClick={onClose} disabled={busy}>{t('common.close')}</Button>
        <Button kind="primary" icon="export" onClick={run} disabled={busy || !targets.size || errors.length > 0}>{busy ? t('export.exporting') : t('export.run')}</Button>
      </>}>
      <div className="export-grid">
        <div>
          <Section id="export.info" title={t('export.gameInfo')}>
            <Field label={t('export.gameTitle')}><TextInput value={s.title} onChange={(v) => upd(t('settings.edit'), (x) => { x.title = v; })} /></Field>
            <div className="field-pair">
              <Field label={t('export.version')}><TextInput value={s.version} onChange={(v) => upd(t('settings.edit'), (x) => { x.version = v; })} /></Field>
              <Field label={t('export.author')}><TextInput value={s.author} onChange={(v) => upd(t('settings.edit'), (x) => { x.author = v; })} /></Field>
            </div>
            <Field label={t('export.identifier')} hint={t('export.identifierHint')}><TextInput value={s.identifier} onChange={(v) => upd(t('settings.edit'), (x) => { x.identifier = v.replace(/[^a-zA-Z0-9.-]/g, ''); })} /></Field>
            <Field label={t('export.icon')} hint={t('export.iconHint')}><AssetPicker project={session.project} kind="image" value={s.iconAssetId || null} onChange={(v) => upd(t('settings.edit'), (x) => { x.iconAssetId = v; })} assetUrl={assetUrl} t={t} /></Field>
          </Section>
          <Section id="export.window" title={t('export.display')}>
            <Field label={t('settings.resolution')}>
              <div className="row-inline">
                <Select value={`${s.resolution.width}x${s.resolution.height}`} options={[...RES.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h}` })), { value: 'custom', label: t('settings.custom') }]}
                  onChange={(v) => { if (v === 'custom') return; const [w, h] = v.split('x').map(Number); upd(t('settings.edit'), (x) => { x.resolution = { width: w, height: h }; x.window.width = w; x.window.height = h; }); }} />
                <NumberInput value={s.resolution.width} min={320} step={1} onChange={(v) => upd(t('settings.edit'), (x) => { x.resolution.width = Math.round(v); })} />
                <NumberInput value={s.resolution.height} min={240} step={1} onChange={(v) => upd(t('settings.edit'), (x) => { x.resolution.height = Math.round(v); })} />
              </div>
            </Field>
            <Field label={t('export.windowMode')}>
              <Select value={s.window.mode} options={[{ value: 'windowed', label: t('export.windowed') }, { value: 'fullscreen', label: t('export.fullscreen') }, { value: 'borderless', label: t('export.borderless') }]} onChange={(v) => upd(t('settings.edit'), (x) => { x.window.mode = v as any; })} />
            </Field>
            <div className="field-pair">
              <Field label={t('export.windowSize')}><div className="row-inline"><NumberInput value={s.window.width} min={320} onChange={(v) => upd(t('settings.edit'), (x) => { x.window.width = Math.round(v); })} /><NumberInput value={s.window.height} min={240} onChange={(v) => upd(t('settings.edit'), (x) => { x.window.height = Math.round(v); })} /></div></Field>
            </div>
            <div className="toggle-stack">
              <Toggle value={s.window.resizable} onChange={(v) => upd(t('settings.edit'), (x) => { x.window.resizable = v; })} label={t('export.resizable')} />
              <Toggle value={s.window.allowFullscreenToggle} onChange={(v) => upd(t('settings.edit'), (x) => { x.window.allowFullscreenToggle = v; })} label={t('export.allowFullscreen')} />
            </div>
          </Section>
        </div>
        <div>
          <Section id="export.targets" title={t('export.platforms')}>
            <div className="target-list">
              {TARGETS.map((tg) => {
                const key = tg.id === 'mac-arm64' ? 'darwin-arm64' : tg.id === 'mac-x64' ? 'darwin-x64' : tg.id === 'win-x64' ? 'win32-x64' : null;
                const cached = key ? templates[key] : 'web';
                return (
                  <label key={tg.id} className={cx('target', targets.has(tg.id) && 'on')}>
                    <input type="checkbox" checked={targets.has(tg.id)} onChange={() => toggleTarget(tg.id)} />
                    <Icon name={tg.icon} size={16} />
                    <span>{t(tg.label)}</span>
                    {key && <span className={cx('muted small', cached ? 'ok' : '')}>{cached ? t('export.runtimeReady') : t('export.runtimeDownload')}</span>}
                  </label>
                );
              })}
            </div>
            <Field label={t('export.output')}>
              <div className="row-inline">
                <TextInput value={outDir} onChange={setOutDir} />
                <Button small icon="folderOpen" onClick={async () => { const p = await store.pickFolder(t('export.output'), outDir); if (p) setOutDir(p); }}>{t('common.browse')}</Button>
              </div>
            </Field>
          </Section>
          <Section id="export.modules" title={t('export.modules', { n: modulesUsed.length })}>
            {!modulesUsed.length && <div className="muted small">{t('export.noModules')}</div>}
            {modulesUsed.map(({ id, rec }) => (
              <div key={id} className="mod-line">
                <Icon name={rec?.status === 'active' ? 'check' : 'error'} size={13} className={rec?.status === 'active' ? 'ok' : 'err'} />
                <span>{rec ? session.i18n.pick(rec.manifest.name as any) : id}</span>
                <span className="muted small">{rec ? `v${rec.manifest.version} · ${rec.manifest.runtime ? t('modules.kind.runtime') : t('modules.kind.editorOnly')}` : t('modules.status.missing')}</span>
              </div>
            ))}
          </Section>
          {session.ext.exporters.length > 0 && (
            <Section id="export.extra" title={t('export.moduleExporters')}>
              <div className="muted small">{t('export.moduleExportersHint')}</div>
              {session.ext.exporters.map((x) => (
                <Button key={`${x.moduleId}/${x.id}`} small icon="module" onClick={async () => {
                  try { await x.run(makeMountContext(session, x.moduleId)); } catch (err) { session.moduleError(x.moduleId, err, 'exporter'); }
                }}>{t(x.label)}</Button>
              ))}
            </Section>
          )}
          <Section id="export.check" title={t('export.validation')}>
            {errors.length > 0 ? <IssueList session={session} issues={errors} limit={8} /> : <div className="issue ok"><Icon name="check" size={14} />{t('export.noErrors')}</div>}
            {warnings.length > 0 && <details><summary className="muted small">{t('export.showWarnings', { n: warnings.length })}</summary><IssueList session={session} issues={warnings} limit={20} /></details>}
          </Section>
        </div>
      </div>
      {result && (
        <div className="export-results">
          {result.outputs.map((o) => (
            <div key={o.path} className="result-row">
              <Icon name="check" size={14} className="ok" /><b>{t(TARGETS.find((x) => x.id === o.target)?.label || o.target)}</b>
              <code>{o.path}</code>
              {isElectron() && <Button small icon="folderOpen" onClick={() => call('shell.reveal', { path: o.path })}>{t('export.reveal')}</Button>}
            </div>
          ))}
          <div className="muted small">{t('export.signingNote')}</div>
        </div>
      )}
      {(logs.length > 0 || error) && (
        <div className="export-log" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
          {error && <div className="err">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
