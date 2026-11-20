/**
 * Entry point of exported games (dist/player/player.js). It reads the game
 * bundle produced by the exporter, activates the bundled runtime modules and
 * starts the same GameRuntime the editor preview uses.
 */
import { I18n, loadProject } from '@vne/core';
import type { Asset } from '@vne/core';
import { createEngine } from './index';
import { GameRuntime } from './game';
import { ModuleHost, ModuleSource } from './modules';

declare global {
  interface Window {
    __VNE_GAME__?: { project: any; modules: ModuleSource[]; assetBase?: string; locale?: string };
    vnePlayer?: { quit?: () => void; setFullscreen?: (v: boolean) => void };
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('game') || document.body;
  const bundle = window.__VNE_GAME__;
  if (!bundle) {
    root.textContent = 'Game data (game.js) is missing.';
    return;
  }
  const { project } = loadProject(bundle.project);
  document.title = project.settings.title;
  const engine = createEngine();
  const i18n = new I18n(bundle.locale || 'en');
  const base = new URL(bundle.assetBase || './', location.href);
  const host = new ModuleHost(engine, i18n, { mode: 'game', onError: (id, err, where) => console.error(`[module ${id}] ${where}`, err) });
  const sources = (bundle.modules || []).map((m) => ({ ...m, baseUrl: new URL(m.baseUrl, location.href).href }));
  const records = await host.loadAll(sources);
  for (const r of records) if (r.status !== 'active') console.warn(`[vne] module ${r.manifest.id}: ${r.status} ${r.error || ''}`);
  const rt = new GameRuntime({
    project,
    engine,
    container: root,
    mode: 'game',
    resolveAssetUrl: (a: Asset) => new URL(a.path.split('/').map(encodeURIComponent).join('/'), base).href,
    onQuit: window.vnePlayer?.quit,
    storageKey: project.id,
  });
  for (const r of records) for (const [loc, dict] of Object.entries(r.source.locales || {})) rt.i18n.add(loc, dict);
  (window as any).__vneRuntime = rt;
  rt.start();
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('game') || document.body;
  root.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#fff;background:#300;padding:24px;white-space:pre-wrap;font:14px monospace';
  pre.textContent = `The game could not start.\n\n${err?.stack || err}`;
  root.append(pre);
});
