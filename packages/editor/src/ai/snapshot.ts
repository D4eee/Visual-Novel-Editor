/**
 * Scene pictures for the AI assistant: draws a scene's stage (as the canvas shows it at a
 * given time, without selection handles) into an image a vision model can look at.
 */
import type { Layer, SceneData } from '@vne/core';
import { hasSceneData, sceneLines } from '@vne/core';
import { CanvasPool, ShaderRunner, VarStore, createEditView, drawScene } from '@vne/runtime';
import type { ProjectSession } from '../state/session';
import { pageCtx } from '../scene/pageContext';

export interface SceneImage { mediaType: 'image/jpeg'; data: string; width: number; height: number }

const imageIds = (layers: Layer[]) => {
  const ids: string[] = [];
  const walk = (v: any) => {
    if (typeof v === 'string' && /^ast_/.test(v)) ids.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const l of layers) walk(l.props);
  return ids;
};

/** Draw a scene at `time` (seconds into its first clip, default 0); long side at most `max` px. */
export async function sceneImage(session: ProjectSession, nodeId: string, opts: { time?: number; max?: number } = {}): Promise<SceneImage> {
  const project = session.project;
  const node = project.nodes[nodeId];
  if (!node || !hasSceneData(node)) throw new Error('Not a scene');
  const scene = node.data as SceneData;
  const { width: W, height: H } = project.settings.resolution;
  const pc = pageCtx(session, nodeId);
  const inherited = pc.inherited.map((e) => e.layer);
  const context = {
    under: [...pc.globalBack, ...inherited.filter((l) => l.type === 'core.background')],
    over: [...inherited.filter((l) => l.type !== 'core.background'), ...pc.globalFront],
  };
  const all = [...scene.layers, ...context.under, ...context.over];
  await Promise.race([session.assets.preloadImages(imageIds(all)), new Promise((r) => setTimeout(r, 4000))]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const pool = new CanvasPool();
  const clip = scene.animations[0];
  const view = createEditView({
    engine: session.engine, project, scene, assets: session.assets, pool, shaders: new ShaderRunner(),
    time: opts.time ?? 0, clipIds: clip ? [clip.id] : [], vars: new VarStore(() => session.project, null), instances: new Map(), context,
  });
  drawScene(ctx, view, scene.background || '#000');
  pool.releaseAll();
  // The text box is HTML in the game; sketch it so the model sees where it sits.
  const line = sceneLines(scene)[0];
  if (line && !scene.hideTextbox && project.settings.textbox) {
    const h = Math.round(H * 0.24);
    ctx.fillStyle = 'rgba(10,12,20,0.72)';
    ctx.fillRect(Math.round(W * 0.02), H - h - Math.round(H * 0.03), Math.round(W * 0.96), h);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(H / 30)}px sans-serif`;
    const who = project.characters.find((c) => c.id === line.speakerId)?.name;
    ctx.fillText(`${who ? who + ': ' : ''}${line.text}`.slice(0, 90), Math.round(W * 0.05), H - h + Math.round(H * 0.04));
  }
  const max = opts.max ?? 1024;
  const k = Math.min(1, max / Math.max(W, H));
  const out = document.createElement('canvas');
  out.width = Math.round(W * k);
  out.height = Math.round(H * k);
  out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
  return { mediaType: 'image/jpeg', data: out.toDataURL('image/jpeg', 0.82).split(',')[1], width: out.width, height: out.height };
}
