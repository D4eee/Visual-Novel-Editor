import { PreviewPanel } from '../preview/PreviewPanel';
import type { SceneData, ScriptStack } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { sceneOf, updateScene } from './sceneOps';
import { CompositionCanvas } from './CompositionCanvas';
import { LayersPanel } from './LayersPanel';
import { Timeline } from './Timeline';
import { EffectsPanel } from '../effects/EffectsPanel';
import { BlockWorkspace, WStack, newBlock } from '../script/BlockEditor';
import { ModuleWorkspace } from '../modules/ModuleWorkspace';
import { Tabs, Button, useResizable } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

export function SceneEditor({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const node = session.project.nodes[nodeId];
  const scene = sceneOf(session, nodeId);
  const ui = session.sceneUI(nodeId);
  const [layersW, startLayers] = useResizable('scene.layers', 236, 180, 420);
  const [dockH, startDock] = useResizable('scene.dock', 300, 160, 640);
  if (!node || !scene) return null;
  const chapter = session.project.chapters.find((c) => c.id === node.chapterId);
  const bottomPanels = session.ext.panels.filter((p) => p.location === 'bottom');
  const tabs = [
    { id: 'timeline', label: t('scene.timeline'), icon: 'timeline', badge: scene.animations.length || null },
    { id: 'behaviors', label: t('scene.behaviors'), icon: 'script', badge: scene.scripts.length || null },
    ...bottomPanels.map((p) => ({ id: p.id, label: t(p.title), icon: p.icon || 'module' })),
  ];

  return (
    <div className="scene-editor">
      <div className="node-head">
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => session.setUI({ chapterId: node.chapterId, active: 0 })}><Icon name="book" size={13} />{chapter?.name}</button>
          <Icon name="chevronRight" size={12} />
          <span className="crumb current"><Icon name="scene" size={13} />#{scene.number} {node.name}</span>
        </div>
        <Tabs value={ui.subTab} onChange={(v) => session.setSceneUI(nodeId, { subTab: v })} tabs={[
          { id: 'composition', label: t('workspace.composition'), icon: 'layers' },
          { id: 'modules', label: t('workspace.modules'), icon: 'module', badge: node.modules.length || null },
        ]} />
        <div className="grow" />
        <Button small icon="play" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now() } })} title={t('preview.thisScene')}>{t('preview.thisScene')}</Button>
      </div>
      {ui.effectsOpen && ui.selectedLayers[0] && (
        <Modal title={t('effects.editFor', { layer: scene.layers.find((l) => l.id === ui.selectedLayers[0])?.name || '' })} icon={<Icon name="sparkles" size={16} />} width={1100} onClose={() => session.setSceneUI(nodeId, { effectsOpen: false })}>
          <div className="effects-modal"><EffectsPanel session={session} nodeId={nodeId} /></div>
        </Modal>
      )}
      {ui.subTab === 'modules' ? <ModuleWorkspace session={session} nodeId={nodeId} /> : (
        <div className="scene-body">
          <div className="scene-top">
            <div className="scene-layers" style={{ width: layersW }}>
              <LayersPanel session={session} nodeId={nodeId} />
            </div>
            <div className="resizer-x" onPointerDown={(e) => startLayers(e, 1)} role="separator" aria-orientation="vertical" />
            <div className="scene-canvas"><CompositionCanvas session={session} nodeId={nodeId} />
              {session.ui.preview?.docked && session.ui.preview.nodeId === nodeId && <PreviewPanel key={session.ui.preview.key} session={session} />}
            </div>
          </div>
          <div className="resizer-y" onPointerDown={(e) => startDock(e, -1, 'y')} role="separator" aria-orientation="horizontal" />
          <div className="scene-dock" style={{ height: dockH }}>
            <Tabs value={ui.bottomTab} onChange={(v) => session.setSceneUI(nodeId, { bottomTab: v })} tabs={tabs} className="dock-tabs" />
            <div className="dock-body">
              {(ui.bottomTab === 'timeline' || !tabs.some((x) => x.id === ui.bottomTab)) && <Timeline session={session} nodeId={nodeId} />}
              {ui.bottomTab === 'behaviors' && <SceneScripts session={session} nodeId={nodeId} scene={scene} />}
              {bottomPanels.filter((p) => p.id === ui.bottomTab).map((p) => <ModulePanelHost key={p.id} session={session} panel={p} nodeId={nodeId} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SceneScripts({ session, nodeId, scene }: { session: ProjectSession; nodeId: string; scene: SceneData }) {
  const t = useT();
  const ui = session.sceneUI(nodeId);
  const stacks: WStack[] = scene.scripts.map((s) => ({ ...s }));
  const layer = scene.layers.find((l) => l.id === ui.selectedLayers[0]);
  const testing = !!(session.ui.preview?.docked && session.ui.preview.nodeId === nodeId);
  const quick = layer && session.engine.layerTypes.get(layer.type)?.visual && layer.type !== 'core.background';
  const addHat = (type: string) => {
    const hat = newBlock(session.engine.blocks.get(type)!);
    hat.args.layer = layer!.id;
    const id = `scr_${Math.random().toString(36).slice(2, 14)}`;
    const n = scene.scripts.length;
    updateScene(session, nodeId, t('script.addScript'), (s) => { s.scripts.push({ id, x: 16 + (n % 3) * 360, y: 16 + Math.floor(n / 3) * 260, enabled: true, hat, body: [] }); });
    session.setSceneUI(nodeId, { scriptId: id });
  };
  return (
    <BlockWorkspace
      stacks={stacks}
      mode="scene"
      ctx={{ project: session.project, scene, t, engine: session.engine, nodeId }}
      selectedStack={ui.scriptId}
      onSelectStack={(id) => session.setSceneUI(nodeId, { scriptId: id })}
      onChange={(recipe, label) => updateScene(session, nodeId, label, (s) => {
        const list = s.scripts as unknown as WStack[];
        recipe(list);
        for (const st of list) if (st.hat === null) st.hat = newBlock(session.engine.blocks.get('core.whenSceneStarts')!);
        s.scripts = list as unknown as ScriptStack[];
      })}
      running={session.runningBlocks}
      header={(
        <div className="blk-test-bar">
          {testing
            ? <Button small icon="stop" onClick={() => session.setUI({ preview: null })}>{t('script.stopTest')}</Button>
            : <Button small kind="primary" icon="play" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now(), docked: true } })} title={t('script.testHint')}>{t('script.test')}</Button>}
          {testing && <Button small kind="ghost" icon="refresh" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now(), docked: true } })}>{t('preview.restart')}</Button>}
          {quick && <>
            <span className="muted small">{layer!.name}:</span>
            <Button small onClick={() => addHat('core.whenLayerClicked')}>{t('script.whenClicked')}</Button>
            <Button small kind="ghost" onClick={() => addHat('core.whenHoverStart')}>{t('script.whenHovered')}</Button>
          </>}
        </div>
      )}
    />
  );
}

import { useEffect, useRef } from 'react';
import { makeMountContext, safeMount, PanelDef } from '../modules/editorApi';

export function ModulePanelHost({ session, panel, nodeId }: { session: ProjectSession; panel: PanelDef; nodeId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return safeMount(ref.current, panel.mount, makeMountContext(session, panel.moduleId, { nodeId }), (err) => session.moduleError(panel.moduleId, err, 'panel'));
  }, [panel.id, nodeId]);
  return <div ref={ref} className="module-mount fill" />;
}
