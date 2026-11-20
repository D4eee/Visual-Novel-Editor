import { useEffect, useRef } from 'react';
import type { ModuleInstance, StoryNode } from '@vne/core';
import { newId } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT, store } from '../state/store';
import { makeMountContext, safeMount } from './editorApi';
import { PropEditor } from '../inspect/PropEditor';
import { Button, IconButton, Toggle, Empty, cx } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { openMenu, MenuItem } from '../ui/Menu';

/**
 * The node's Module workspace: attach module components to this node, configure
 * them with generated forms or the module's own interface, enable/disable and
 * inspect dependencies. Data of unavailable modules is shown and preserved.
 */
export function ModuleWorkspace({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const node = session.project.nodes[nodeId];
  if (!node) return null;
  const available = session.engine.components.list().filter((c) => c.nodeTypes === '*' || c.nodeTypes.includes(node.type));

  const add = (componentId: string) => {
    const def = session.engine.components.get(componentId)!;
    if (!def.multiple && node.modules.some((m) => m.component === componentId)) { store.toast(t('modules.onlyOnce'), 'error'); return; }
    const data: Record<string, unknown> = {};
    for (const p of def.props) if (p.default !== undefined) data[p.key] = p.default;
    Object.assign(data, def.defaults?.() || {});
    const inst: ModuleInstance = { id: newId('mod'), moduleId: def.owner || componentId.split('/')[0], component: componentId, enabled: true, data };
    session.update(t('modules.attach'), (d) => {
      d.nodes[nodeId].modules.push(inst);
      if (inst.moduleId !== 'core' && !d.modules.some((m) => m.id === inst.moduleId)) {
        const rec = session.moduleRecords.find((r) => r.manifest.id === inst.moduleId);
        d.modules.push({ id: inst.moduleId, version: rec ? `^${rec.manifest.version}` : '*', enabled: true });
      }
    });
  };

  const addMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = available.map((c) => ({ label: t(c.label), icon: c.icon || 'module', hint: c.description ? t(c.description) : undefined, onClick: () => add(c.id) }));
    if (!items.length) items.push({ label: t('modules.noneForNode'), disabled: true });
    items.push({ separator: true }, { label: t('modules.manage'), icon: 'settings', onClick: () => store.open({ kind: 'modules' }) });
    openMenu(e, items, { search: items.length > 10, title: t('modules.attachTitle') });
  };

  return (
    <div className="module-workspace">
      <div className="mw-head">
        <div>
          <h3 title={t('modules.workspaceIntro')}>{t('workspace.modules')}</h3>
        </div>
        <div className="grow" />
        <Button kind="primary" icon="plus" onClick={addMenu}>{t('modules.attach')}</Button>
        <Button icon="settings" onClick={() => store.open({ kind: 'modules' })}>{t('modules.manage')}</Button>
      </div>
      {!node.modules.length ? (
        <Empty icon="module" title={t('modules.noneAttached')} action={<Button icon="plus" onClick={addMenu}>{t('modules.attach')}</Button>}>
          {available.length ? t('modules.availableN', { n: available.length }) : t('modules.installHint')}
        </Empty>
      ) : (
        <div className="mw-list">
          {node.modules.map((inst, i) => <ModuleCard key={inst.id} session={session} node={node} inst={inst} index={i} />)}
        </div>
      )}
    </div>
  );
}

function ModuleCard({ session, node, inst, index }: { session: ProjectSession; node: StoryNode; inst: ModuleInstance; index: number }) {
  const t = useT();
  const def = session.engine.components.get(inst.component);
  const rec = session.moduleRecords.find((r) => r.manifest.id === inst.moduleId);
  const custom = session.ext.nodeWorkspaces.find((w) => w.component === inst.component);
  const upd = (label: string, fn: (m: ModuleInstance) => void, mk?: string) => session.update(label, (d) => { const m = d.nodes[node.id].modules.find((x) => x.id === inst.id); if (m) fn(m); }, mk ? { mergeKey: mk } : undefined);
  const deps = rec ? Object.entries(rec.manifest.dependencies || {}) : [];
  const errors = session.moduleErrors.filter((e) => e.moduleId === inst.moduleId).slice(-3);
  const issues = session.issues.filter((i) => i.target?.nodeId === node.id && (i.target?.moduleId === inst.moduleId || i.code.startsWith('module')));
  return (
    <div className={cx('module-card', !inst.enabled && 'disabled', !def && 'missing')}>
      <header>
        <Icon name={def?.icon || 'module'} size={16} />
        <div className="mc-title">
          <b>{def ? t(def.label) : inst.component}</b>
          <span className="muted small">{rec ? `${session.i18n.pick(rec.manifest.name as any)} · v${rec.manifest.version}` : inst.moduleId}</span>
        </div>
        <div className="grow" />
        <Toggle value={inst.enabled} onChange={(v) => upd(v ? t('modules.enable') : t('modules.disable'), (m) => { m.enabled = v; })} title={t('modules.enabledHint')} />
        <IconButton icon="more" size={15} title={t('common.more')} onClick={(e) => openMenu(e, [
          { label: t('modules.moveUp'), icon: 'arrowUp', disabled: index === 0, onClick: () => session.update(t('modules.reorder'), (d) => { const list = d.nodes[node.id].modules; const [m] = list.splice(index, 1); list.splice(index - 1, 0, m); }) },
          { label: t('modules.moveDown'), icon: 'arrowDown', disabled: index === node.modules.length - 1, onClick: () => session.update(t('modules.reorder'), (d) => { const list = d.nodes[node.id].modules; const [m] = list.splice(index, 1); list.splice(index + 1, 0, m); }) },
          { label: t('modules.resetData'), icon: 'refresh', disabled: !def, onClick: async () => { if (await store.confirm(t('modules.resetData'), t('modules.resetConfirm'), t('modules.reset'), true)) upd(t('modules.resetData'), (m) => { const d: any = {}; for (const p of def!.props) if (p.default !== undefined) d[p.key] = p.default; m.data = { ...d, ...(def!.defaults?.() || {}) }; }); } },
          { separator: true },
          { label: t('modules.detach'), icon: 'trash', danger: true, onClick: async () => { if (await store.confirm(t('modules.detach'), t('modules.detachConfirm', { name: def ? t(def.label) : inst.component }), t('modules.detach'), true)) session.update(t('modules.detach'), (d) => { d.nodes[node.id].modules = d.nodes[node.id].modules.filter((m) => m.id !== inst.id); }); } },
        ])} />
      </header>
      {!def ? (
        <div className="mc-body">
          <div className="issue error"><Icon name="error" size={14} />{t('modules.componentMissing', { module: inst.moduleId })}</div>
          <div className="muted small">{t('modules.dataPreserved', { n: Object.keys(inst.data || {}).length })}</div>
          <pre className="json-view">{JSON.stringify(inst.data, null, 2).slice(0, 800)}</pre>
          <Button small icon="settings" onClick={() => store.open({ kind: 'modules' })}>{t('modules.findModule')}</Button>
        </div>
      ) : (
        <div className="mc-body">
          {def.description && <div className="muted small">{t(def.description)}</div>}
          {def.props.length > 0 && (
            <PropEditor defs={def.props} values={inst.data} idPrefix={`mod.${inst.component}`}
              onChange={(k, v, tr) => upd(t('modules.editData'), (m) => { m.data = { ...m.data, [k]: v }; }, tr ? `mod-${inst.id}-${k}` : undefined)}
              ctx={{ project: session.project, scene: node.type === 'core.scene' ? (node.data as any) : null, t, assetUrl: (id) => { const a = session.project.assets.find((x) => x.id === id); return a ? session.assetUrl(a) : null; }, values: inst.data }} />
          )}
          {custom && <CustomMount session={session} node={node} inst={inst} mount={custom.mount} moduleId={custom.moduleId} />}
          {deps.length > 0 && (
            <div className="mc-deps">
              <span className="muted small">{t('modules.dependencies')}:</span>
              {deps.map(([id, range]) => {
                const ok = session.moduleRecords.find((r) => r.manifest.id === id)?.status === 'active';
                return <span key={id} className={cx('dep', ok ? 'ok' : 'bad')}><Icon name={ok ? 'check' : 'error'} size={11} />{id} {range}</span>;
              })}
            </div>
          )}
          {[...issues.map((i) => t(i.message, i.params)), ...errors.map((e) => `${e.where}: ${e.message}`)].map((m, k) => <div key={k} className="issue error slim"><Icon name="error" size={13} />{m}</div>)}
        </div>
      )}
    </div>
  );
}

function CustomMount({ session, node, inst, mount, moduleId }: { session: ProjectSession; node: StoryNode; inst: ModuleInstance; mount: any; moduleId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (!ref.current) return;
    return safeMount(ref.current, mount, makeMountContext(session, moduleId, {
      nodeId: node.id, instanceId: inst.id, data: inst.data,
      setData: (patch, label) => session.update(label || t('modules.editData'), (d) => { const m = d.nodes[node.id].modules.find((x) => x.id === inst.id); if (m) m.data = { ...m.data, ...patch }; }),
    }), (err) => session.moduleError(moduleId, err, 'nodeWorkspace'));
  }, [inst.id, JSON.stringify(inst.data)]);
  return <div ref={ref} className="module-mount" />;
}
