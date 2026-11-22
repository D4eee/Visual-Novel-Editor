import { resolveFontFamily } from '@vne/runtime';
import { useMemo, useRef, useState } from 'react';
import type { Asset, AssetKind } from '@vne/core';
import { assetUsage, hasSceneData } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { call, droppedPath, fileToBase64, isElectron } from '../host';
import { Icon } from '../ui/Icon';
import { IconButton, Button, cx, TextInput, Empty } from '../ui/controls';
import { openMenu } from '../ui/Menu';
import { AssetThumb } from '../inspect/AssetPicker';

const KINDS: (AssetKind | 'all')[] = ['all', 'image', 'audio', 'video', 'font'];

export async function importFiles(session: ProjectSession, files: File[] | string[]): Promise<Asset[]> {
  const t = session.i18n.t;
  if (!files.length) return [];
  const payload = await Promise.all((files as any[]).map(async (f) => {
    if (typeof f === 'string') return { name: f.split(/[\\/]/).pop(), sourcePath: f };
    const p = droppedPath(f);
    if (p) return { name: f.name, sourcePath: p };
    return { name: f.name, dataBase64: await fileToBase64(f) };
  }));
  try {
    const r = await call('assets.import', { path: session.path, files: payload, existing: session.project.assets });
    if (r.assets.length) session.update(t('assets.import', { n: r.assets.length }), (d) => { d.assets.push(...r.assets); });
    // custom importers from modules
    for (const imp of session.ext.importers) {
      const mine = (files as any[]).filter((f) => typeof f !== 'string' && imp.extensions.some((x) => f.name.toLowerCase().endsWith(x.toLowerCase())));
      if (!mine.length) continue;
      const list = await Promise.all(mine.map(async (f: File) => ({ name: f.name, base64: await fileToBase64(f), text: f.size < 2_000_000 ? await f.text() : undefined })));
      try { await imp.import(list, (await import('../modules/editorApi')).makeMountContext(session, imp.moduleId)); } catch (err) { session.moduleError(imp.moduleId, err, 'importer'); }
    }
    if (r.errors.length) store.toast(r.errors.join('\n'), 'error');
    else if (r.reused.length && !r.assets.length) store.toast(t('assets.alreadyImported', { n: r.reused.length }));
    else store.toast(t('assets.imported', { n: r.assets.length }), 'success');
    return [...r.assets, ...session.project.assets.filter((a) => r.reused.includes(a.id))];
  } catch (err: any) {
    store.toast(err.message, 'error');
    return [];
  }
}

export function AssetLibrary({ session }: { session: ProjectSession }) {
  useSession(session);
  const t = useT();
  const project = session.project;
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const usage = useMemo(() => assetUsage(project), [project]);
  const list = project.assets.filter((a) => (kind === 'all' || a.kind === kind) && (!query || a.name.toLowerCase().includes(query.toLowerCase()) || a.tags.some((x) => x.toLowerCase().includes(query.toLowerCase()))));
  const sel = project.assets.find((a) => a.id === selected) || null;

  const pick = async () => {
    if (isElectron()) {
      const files = await store.pickFiles(t('assets.importTitle'), [{ name: t('assets.media'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'mp3', 'ogg', 'wav', 'm4a', 'flac', 'opus', 'mp4', 'webm', 'mov', 'm4v', 'ttf', 'otf', 'woff', 'woff2'] }]);
      if (files.length) await importFiles(session, files);
    } else fileInput.current?.click();
  };

  const relink = async (a: Asset) => {
    let file: any = null;
    if (isElectron()) {
      const f = await store.pickFiles(t('assets.relinkTitle', { name: a.name }));
      if (f[0]) file = { name: f[0].split(/[\\/]/).pop(), sourcePath: f[0] };
    } else {
      file = await new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.onchange = async () => { const f = inp.files?.[0]; resolve(f ? { name: f.name, dataBase64: await fileToBase64(f) } : null); };
        inp.click();
      });
    }
    if (!file) return;
    try {
      const updated = await call('assets.relink', { path: session.path, asset: a, file });
      session.update(t('assets.relink'), (d) => { const i = d.assets.findIndex((x) => x.id === a.id); if (i >= 0) d.assets[i] = updated; });
      session.assets.invalidate(a.id);
      await session.refreshMissingAssets();
      store.toast(t('assets.relinked', { name: a.name }), 'success');
    } catch (err: any) { store.toast(err.message, 'error'); }
  };

  const remove = async (a: Asset) => {
    const used = usage.get(a.id)?.length || 0;
    if (used) {
      const ok = await store.confirm(t('assets.removeTitle'), t('assets.removeUsed', { name: a.name, n: used }), t('common.remove'), true);
      if (!ok) return;
    }
    session.update(t('assets.remove'), (d) => { d.assets = d.assets.filter((x) => x.id !== a.id); });
    setSelected(null);
  };

  const missingCount = project.assets.filter((a) => session.missingAssets.has(a.id)).length;

  return (
    <div className={cx('assets', over && 'drop-over')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={async (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); await importFiles(session, [...e.dataTransfer.files]); }}>
      <input ref={fileInput} type="file" multiple hidden accept="image/*,audio/*,video/*,.ttf,.otf,.woff,.woff2" onChange={async (e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) await importFiles(session, f); }} />
      <div className="side-search">
        <Icon name="search" size={14} />
        <input placeholder={t('assets.search')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('assets.search')} />
        <IconButton icon="imagePlus" title={t('imggen.title')} onClick={() => store.open({ kind: 'generateImage' })} />
        <IconButton icon="upload" title={t('assets.importButton')} onClick={pick} />
      </div>
      <div className="chips">
        {KINDS.map((k) => <button key={k} type="button" className={cx('chip', kind === k && 'active')} onClick={() => setKind(k)}>{t(`assets.kind.${k}`)} <span className="muted">{k === 'all' ? project.assets.length : project.assets.filter((a) => a.kind === k).length}</span></button>)}
      </div>
      {missingCount > 0 && <div className="issue error slim"><Icon name="error" size={14} />{t('assets.missingCount', { n: missingCount })}</div>}
      {!project.assets.length ? (
        <Empty icon="image" title={t('assets.emptyTitle')} action={<div className="row-gap"><Button kind="primary" icon="upload" onClick={pick}>{t('assets.importButton')}</Button><Button icon="imagePlus" onClick={() => store.open({ kind: 'generateImage' })}>{t('imggen.generateShort')}</Button></div>}>{t('assets.emptyText')}</Empty>
      ) : (
        <div className="asset-grid">
          {list.map((a) => {
            const missing = session.missingAssets.has(a.id);
            const used = usage.get(a.id)?.length || 0;
            return (
              <button key={a.id} type="button" className={cx('asset-item', selected === a.id && 'active', missing && 'missing')}
                draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-vne-asset', a.id); e.dataTransfer.setData('text/plain', a.name); e.dataTransfer.effectAllowed = 'copyLink'; }}
                onClick={() => setSelected(a.id)}
                onContextMenu={(e) => { e.preventDefault(); setSelected(a.id); openMenu(e, [
                  { label: t('assets.relink'), icon: 'link', onClick: () => relink(a) },
                  { label: t('common.rename'), icon: 'text', onClick: async () => { const v = await store.prompt(t('common.rename'), t('common.name'), a.name); if (v) session.update(t('common.rename'), (d) => { d.assets.find((x) => x.id === a.id)!.name = v; }); } },
                  { separator: true },
                  { label: t('assets.remove'), icon: 'trash', danger: true, onClick: () => remove(a) },
                ]); }}
                title={`${a.name}\n${a.path}`}>
                <AssetThumb url={missing ? null : session.assetUrl(a)} kind={a.kind} size={64} />
                <span className="asset-name">{a.name}</span>
                {missing && <span className="asset-flag err" title={t('assets.missingFile')}><Icon name="error" size={12} /></span>}
                {!missing && used === 0 && <span className="asset-flag muted" title={t('assets.unused')}>○</span>}
              </button>
            );
          })}
        </div>
      )}
      {sel && <AssetDetails session={session} asset={sel} uses={usage.get(sel.id) || []} onRelink={() => relink(sel)} onRemove={() => remove(sel)} onClose={() => setSelected(null)} />}
      <div className="muted small pad tip">{t('assets.dropTip')}</div>
    </div>
  );
}

function AssetDetails({ session, asset, uses, onRelink, onRemove, onClose }: { session: ProjectSession; asset: Asset; uses: { nodeId?: string; path: string; layerId?: string }[]; onRelink: () => void; onRemove: () => void; onClose: () => void }) {
  const t = session.i18n.t;
  const url = session.assetUrl(asset);
  const missing = session.missingAssets.has(asset.id);
  const saveMeta = (meta: Record<string, any>) => {
    const changed = Object.entries(meta).some(([k, v]) => asset.meta[k] !== v);
    if (changed) session.update(t('assets.meta'), (d) => { const a = d.assets.find((x) => x.id === asset.id); if (a) Object.assign(a.meta, meta); }, { mergeKey: 'meta' });
  };
  return (
    <div className="asset-details">
      <header><b title={asset.name}>{asset.name}</b><IconButton icon="close" size={14} title={t('common.close')} onClick={onClose} /></header>
      {missing ? <div className="issue error"><Icon name="error" size={14} />{t('assets.missingFileAt', { path: asset.path })}</div> : (
        <div className="asset-preview">
          {asset.kind === 'image' && <img src={url} alt="" onLoad={(e) => saveMeta({ width: (e.target as HTMLImageElement).naturalWidth, height: (e.target as HTMLImageElement).naturalHeight })} />}
          {asset.kind === 'audio' && <audio src={url} controls preload="metadata" onLoadedMetadata={(e) => saveMeta({ duration: Math.round((e.target as HTMLAudioElement).duration * 100) / 100 })} />}
          {asset.kind === 'video' && <video src={url} controls preload="metadata" muted onLoadedMetadata={(e) => { const v = e.target as HTMLVideoElement; saveMeta({ duration: Math.round(v.duration * 100) / 100, width: v.videoWidth, height: v.videoHeight }); }} />}
          {asset.kind === 'font' && <div className="font-sample" style={{ fontFamily: resolveFontFamily(session.project, asset.id) }}>Aa 永字八法 The quick brown fox<br />0123456789 ！？…</div>}
        </div>
      )}
      <dl className="meta">
        <dt>{t('assets.path')}</dt><dd title={asset.path}>{asset.path}</dd>
        {asset.size !== undefined && <><dt>{t('assets.size')}</dt><dd>{(asset.size / 1024).toFixed(asset.size > 1e6 ? 0 : 1)} KB</dd></>}
        {asset.meta.width && <><dt>{t('assets.dimensions')}</dt><dd>{asset.meta.width} × {asset.meta.height}</dd></>}
        {asset.meta.duration && <><dt>{t('assets.duration')}</dt><dd>{asset.meta.duration}s</dd></>}
      </dl>
      <div className="row-label">{t('assets.tags')}</div>
      <TextInput value={asset.tags.join(', ')} placeholder={t('assets.tagsPlaceholder')} onChange={(v) => session.update(t('assets.tags'), (d) => { d.assets.find((x) => x.id === asset.id)!.tags = v.split(',').map((s) => s.trim()).filter(Boolean); })} />
      <div className="row-label">{t('assets.usedIn', { n: uses.length })}</div>
      <div className="uses">
        {uses.slice(0, 20).map((u, i) => {
          const node = u.nodeId ? session.project.nodes[u.nodeId] : null;
          return (
            <button key={i} type="button" className="link-row" disabled={!node} onClick={() => {
              if (!node) return;
              if (hasSceneData(node)) { session.openNode(node.id); if (u.layerId) session.setSceneUI(node.id, { selectedLayers: [u.layerId] }); }
              else session.focusNode(node.id);
            }}>
              <Icon name={node ? 'scene' : 'settings'} size={13} /><span>{node ? node.name : t(`refs.${u.path.split('.')[0]}`)}</span>
            </button>
          );
        })}
        {!uses.length && <div className="muted small">{t('assets.notUsed')}</div>}
      </div>
      <div className="row-inline">
        <Button small icon="link" onClick={onRelink}>{missing ? t('assets.relinkMissing') : t('assets.replace')}</Button>
        <Button small icon="trash" kind="ghost" onClick={onRemove}>{t('assets.remove')}</Button>
      </div>
    </div>
  );
}
