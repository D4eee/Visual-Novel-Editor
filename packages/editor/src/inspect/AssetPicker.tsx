import { useRef } from 'react';
import type { Project, AssetKind } from '@vne/core';
import { Icon } from '../ui/Icon';
import { openMenuBelow, MenuItem } from '../ui/Menu';

export function AssetThumb({ url, kind, size = 28 }: { url: string | null; kind: AssetKind; size?: number }) {
  if (kind === 'image' && url) return <img className="asset-thumb" src={url} alt="" style={{ width: size, height: size }} loading="lazy" />;
  const icon = kind === 'audio' ? 'music' : kind === 'video' ? 'film' : kind === 'font' ? 'type' : 'file';
  return <span className="asset-thumb icon" style={{ width: size, height: size }}><Icon name={icon} size={Math.round(size * 0.55)} /></span>;
}

/** Dropdown listing project assets of one kind, with thumbnails. Accepts drops from the asset library. */
export function AssetPicker({ project, kind, value, onChange, assetUrl, t }: { project: Project; kind?: string; value: string | null; onChange: (id: string | null) => void; assetUrl: (id: string) => string | null; t: (k: string, p?: any) => string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const asset = project.assets.find((a) => a.id === value);
  const list = project.assets.filter((a) => !kind || a.kind === kind);
  const open = () => {
    const items: MenuItem[] = [
      { label: t('common.none'), icon: 'close', onClick: () => onChange(null) },
      ...(list.length ? [{ separator: true } as MenuItem] : []),
      ...list.map((a) => ({ label: a.name, icon: a.kind === 'image' ? 'image' : a.kind === 'audio' ? 'music' : a.kind === 'video' ? 'film' : 'file', checked: a.id === value, onClick: () => onChange(a.id) })),
    ];
    if (!list.length) items.push({ label: t('assets.noneOfKind'), disabled: true });
    openMenuBelow(ref.current!, items, { search: list.length > 8 });
  };
  return (
    <button
      ref={ref}
      type="button"
      className={`asset-picker${value && !asset ? ' missing' : ''}`}
      onClick={open}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-vne-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; } }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/x-vne-asset');
        const a = project.assets.find((x) => x.id === id);
        if (a && (!kind || a.kind === kind)) { e.preventDefault(); onChange(id); }
      }}
      title={asset?.path}
    >
      {asset ? <AssetThumb url={assetUrl(asset.id)} kind={asset.kind} size={24} /> : <span className="asset-thumb icon empty-thumb"><Icon name={value ? 'warning' : 'plus'} size={14} /></span>}
      <span className="asset-picker-name">{asset ? asset.name : value ? t('assets.missingRef') : t('assets.choose')}</span>
      <Icon name="chevronDown" size={14} />
    </button>
  );
}
