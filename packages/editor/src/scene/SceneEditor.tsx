import { PreviewPanel } from '../preview/PreviewPanel';
import type { SceneData, ScriptStack } from '@vne/core';
import type { ProjectSession } from '../state/session';
import { useSession, useT } from '../state/store';
import { sceneOf, updateScene } from './sceneOps';
import { CompositionCanvas, addLayerMenu } from './CompositionCanvas';
import { openMenu } from '../ui/Menu';
import { LayersPanel } from './LayersPanel';
import { Timeline } from './Timeline';
import { EffectsPanel } from '../effects/EffectsPanel';
import { BlockWorkspace, WStack, newBlock } from '../script/BlockEditor';
import { ModuleWorkspace } from '../modules/ModuleWorkspace';
import { Tabs, Button, useResizable } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { GLOBAL_NODE_ID } from '@vne/core';
import { GamePanel, GameModal } from '../script/GameEditors';
import type { GameOpen } from '../script/GameEditors';
import { pageElements } from './pageContext';
import { useEffect, useState } from 'react';
import { ScriptView } from './ScriptView';
import { IconButton, cx, shortcut } from '../ui/controls';

export function SceneEditor({ session, nodeId }: { session: ProjectSession; nodeId: string }) {
  useSession(session);
  const t = useT();
  const node = session.project.nodes[nodeId];
  const scene = sceneOf(session, nodeId);
  const ui = session.sceneUI(nodeId);
  const [layersW, startLayers] = useResizable('scene.layers', 236, 180, 420);
  const [dockH, startDock] = useResizable('scene.dock', 300, 160, 640);
  const [layersHidden, setLayersHidden] = useStoredFlag('vne.scene.layersHidden');
  const [dockHidden, setDockHidden] = useStoredFlag('vne.scene.dockHidden');
  // Mod+\ gives the canvas all the room (and brings the panels back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      e.preventDefault();
      const focus = !(layersHidden && dockHidden);
      setLayersHidden(focus);
      setDockHidden(focus);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layersHidden, dockHidden]);
  if (!node || !scene) return null;
  const chapter = session.project.chapters.find((c) => c.id === node.chapterId);
  const isGlobal = nodeId === GLOBAL_NODE_ID;
  const bottomPanels = session.ext.panels.filter((p) => p.location === 'bottom');
  const tabs = [
    { id: 'timeline', label: t('scene.timeline'), icon: 'timeline', badge: scene.animations.length || null },
    { id: 'behaviors', label: t('scene.behaviors'), icon: 'script', badge: scene.scripts.length || null },
    ...bottomPanels.map((p) => ({ id: p.id, label: t(p.title), icon: p.icon || 'module' })),
  ];

  return (
    <div className="scene-editor">
      <div className="node-head">
        {isGlobal ? (
          <div className="crumbs">
            <span className="crumb current"><Icon name="globe" size={13} />{t('global.title')}</span>
            <span className="muted small global-hint">{t('global.headerHint')}</span>
          </div>
        ) : (
          <div className="crumbs">
            <button type="button" className="crumb" onClick={() => session.setUI({ chapterId: node.chapterId, active: 0 })}><Icon name="book" size={13} /><span className="crumb-text">{chapter?.name}</span></button>
            <Icon name="chevronRight" size={12} />
            <span className="crumb current"><Icon name="scene" size={13} /><span className="crumb-text">#{scene.number} {node.name}</span></span>
          </div>
        )}
        <Tabs value={ui.subTab} onChange={(v) => session.setSceneUI(nodeId, { subTab: v })} tabs={[
          { id: 'composition', label: t('workspace.composition'), icon: 'layers' },
          ...(isGlobal ? [] : [{ id: 'script' as const, label: t('workspace.script'), icon: 'fileText' }]),
          { id: 'modules', label: t('workspace.modules'), icon: 'module', badge: node.modules.length || null },
        ]} />
        <div className="grow" />
        {ui.subTab === 'composition' && (
          <span className="panel-toggles">
            <IconButton icon="layers" size={15} active={!layersHidden} title={layersHidden ? t('scene.showLayers') : t('scene.hideLayers')} onClick={() => setLayersHidden(!layersHidden)} />
            <IconButton icon="timeline" size={15} active={!dockHidden} title={dockHidden ? t('scene.showDock') : t('scene.hideDock')} onClick={() => setDockHidden(!dockHidden)} />
            <IconButton icon="maximize" size={15} active={layersHidden && dockHidden} title={`${t('scene.focusCanvas')} (${shortcut('Mod+\\')})`} onClick={() => { const f = !(layersHidden && dockHidden); setLayersHidden(f); setDockHidden(f); }} />
          </span>
        )}
        {!isGlobal && <Button small icon="play" className="head-preview" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now() } })} title={t('preview.thisScene')}><span>{t('preview.thisScene')}</span></Button>}
      </div>
      {ui.effectsOpen && ui.selectedLayers[0] && (
        <Modal title={t('effects.editFor', { layer: scene.layers.find((l) => l.id === ui.selectedLayers[0])?.name || '' })} icon={<Icon name="sparkles" size={16} />} width={1100} onClose={() => session.setSceneUI(nodeId, { effectsOpen: false })}>
          <div className="effects-modal"><EffectsPanel session={session} nodeId={nodeId} /></div>
        </Modal>
      )}
      {ui.subTab === 'script' && !isGlobal ? <ScriptView session={session} nodeId={nodeId} /> : ui.subTab === 'modules' ? <ModuleWorkspace session={session} nodeId={nodeId} /> : (
        <div className="scene-body">
          <div className="scene-top">
            {layersHidden ? (
              <button type="button" className="layers-strip" onClick={() => setLayersHidden(false)} title={t('scene.showLayers')}><Icon name="layers" size={15} /><span>{t('scene.layersShort')}</span></button>
            ) : (
              <>
                <div className="scene-layers" style={{ width: layersW }}>
                  <LayersPanel session={session} nodeId={nodeId} />
                </div>
                <div className="resizer-x" onPointerDown={(e) => startLayers(e, 1)} role="separator" aria-orientation="vertical" />
              </>
            )}
            <div className="scene-canvas"><CompositionCanvas session={session} nodeId={nodeId} />
              {session.ui.preview?.docked && session.ui.preview.nodeId === nodeId && <PreviewPanel key={session.ui.preview.key} session={session} />}
            </div>
          </div>
          {!dockHidden && <div className="resizer-y" onPointerDown={(e) => startDock(e, -1, 'y')} role="separator" aria-orientation="horizontal" />}
          <div className={cx('scene-dock', dockHidden && 'collapsed')} style={dockHidden ? undefined : { height: dockH }}>
            <Tabs value={ui.bottomTab} onChange={(v) => { session.setSceneUI(nodeId, { bottomTab: v }); if (dockHidden) setDockHidden(false); }} tabs={tabs} className="dock-tabs"
              right={<IconButton icon={dockHidden ? 'chevronUp' : 'chevronDown'} size={14} title={dockHidden ? t('scene.showDock') : t('scene.hideDock')} onClick={() => setDockHidden(!dockHidden)} />} />
            {!dockHidden && <div className="dock-body">
              {(ui.bottomTab === 'timeline' || !tabs.some((x) => x.id === ui.bottomTab)) && <Timeline session={session} nodeId={nodeId} />}
              {ui.bottomTab === 'behaviors' && <SceneScripts session={session} nodeId={nodeId} scene={scene} />}
              {bottomPanels.filter((p) => p.id === ui.bottomTab).map((p) => <ModulePanelHost key={p.id} session={session} panel={p} nodeId={nodeId} />)}
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A remembered on/off switch (per computer). */
function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  return [v, (x: boolean) => { setV(x); try { localStorage.setItem(key, x ? '1' : '0'); } catch { /* ignore */ } }];
}

function SceneScripts({ session, nodeId, scene }: { session: ProjectSession; nodeId: string; scene: SceneData }) {
  const t = useT();
  const ui = session.sceneUI(nodeId);
  const stacks: WStack[] = scene.scripts.map((s) => ({ ...s }));
  // The selected element may also be an inherited or a global one.
  const layer = pageElements(session, nodeId).find((e) => e.layer.id === ui.selectedLayers[0])?.layer;
  const [gameOpen, setGameOpen] = useState<GameOpen>(null);
  const isGlobal = nodeId === GLOBAL_NODE_ID;
  const testing = !!(session.ui.preview?.docked && session.ui.preview.nodeId === nodeId);
  const { width: W, height: H } = session.project.settings.resolution;
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
      selectedLayer={layer?.id || null}
      onSelectLayer={(id) => session.setSceneUI(nodeId, { selectedLayers: [id] })}
      onNewElement={(e) => openMenu(e, addLayerMenu(session, nodeId, t, { x: W / 2, y: H / 2 }, { fromScripts: true }))}
      onOpenElement={(id) => setGameOpen({ kind: 'element', id })}
      categoryExtra={(cat, api) => cat === 'game' ? <GamePanel session={session} nodeId={nodeId} api={api} setOpen={setGameOpen} /> : null}
      header={isGlobal ? (
        <div className="blk-test-bar"><Icon name="globe" size={13} /><span className="muted small">{t('global.scriptsHint')}</span>
          <GameModal session={session} nodeId={nodeId} open={gameOpen} onClose={() => setGameOpen(null)} /></div>
      ) : (
        <div className="blk-test-bar">
          <GameModal session={session} nodeId={nodeId} open={gameOpen} onClose={() => setGameOpen(null)} />
          {testing
            ? <Button small icon="stop" onClick={() => session.setUI({ preview: null })}>{t('script.stopTest')}</Button>
            : <Button small kind="primary" icon="play" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now(), docked: true } })} title={t('script.testHint')}>{t('script.test')}</Button>}
          {testing && <Button small kind="ghost" icon="refresh" onClick={() => session.setUI({ preview: { scope: 'scene', nodeId, key: Date.now(), docked: true } })}>{t('preview.restart')}</Button>}
        </div>
      )}
    />
  );
}

import { useRef } from 'react';
import { makeMountContext, safeMount, PanelDef } from '../modules/editorApi';

export function ModulePanelHost({ session, panel, nodeId }: { session: ProjectSession; panel: PanelDef; nodeId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return safeMount(ref.current, panel.mount, makeMountContext(session, panel.moduleId, { nodeId }), (err) => session.moduleError(panel.moduleId, err, 'panel'));
  }, [panel.id, nodeId]);
  return <div ref={ref} className="module-mount fill" />;
}
