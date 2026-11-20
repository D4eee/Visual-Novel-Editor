import type { EffectGraph, EffectNode, EffectEdge, EffectParam } from '@vne/core';
import { newId } from '@vne/core';

type N = { key: string; type: string; x: number; y: number; values?: Record<string, any> };
type E = [string, string, string, string];

function build(name: string, nodes: N[], edges: E[], params: EffectParam[] = []): EffectGraph {
  const ids = new Map(nodes.map((n) => [n.key, newId('fxn')]));
  const outNodes: EffectNode[] = nodes.map((n) => ({ id: ids.get(n.key)!, type: n.type, x: n.x, y: n.y, values: n.values || {} }));
  const outEdges: EffectEdge[] = edges.map(([a, ap, b, bp]) => ({ id: newId('fxe'), from: { node: ids.get(a)!, port: ap }, to: { node: ids.get(b)!, port: bp } }));
  return { id: newId('fxg'), name, nodes: outNodes, edges: outEdges, params };
}

/** Starting points for the procedural effect editor. Each preset is an ordinary, editable graph. */
export const EFFECT_PRESETS: { id: string; label: string; make: () => EffectGraph }[] = [
  { id: 'empty', label: 'preset.empty', make: () => build('Effect', [{ key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'out', type: 'fx.output', x: 520, y: 80 }], [['in', 'image', 'out', 'image']]) },
  { id: 'glow', label: 'preset.glow', make: () => {
    const p: EffectParam = { id: 'glow', name: 'Glow', type: 'number', default: 18, min: 0, max: 80 };
    return build('Glow', [
      { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'param', type: 'fx.param', x: 40, y: 220, values: { param: 'glow' } },
      { key: 'glow', type: 'fx.glow', x: 300, y: 80, values: { color: '#ffe8a8', radius: 18, strength: 1 } }, { key: 'out', type: 'fx.output', x: 580, y: 80 },
    ], [['in', 'image', 'glow', 'image'], ['param', 'value', 'glow', 'radius'], ['glow', 'image', 'out', 'image']], [p]);
  } },
  { id: 'blur', label: 'preset.blur', make: () => build('Blur', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'param', type: 'fx.param', x: 40, y: 220, values: { param: 'blur' } },
    { key: 'blur', type: 'fx.blur', x: 300, y: 80, values: { radius: 6 } }, { key: 'out', type: 'fx.output', x: 560, y: 80 },
  ], [['in', 'image', 'blur', 'image'], ['param', 'value', 'blur', 'radius'], ['blur', 'image', 'out', 'image']], [{ id: 'blur', name: 'Blur', type: 'number', default: 6, min: 0, max: 60 }]) },
  { id: 'dream', label: 'preset.dream', make: () => build('Dreamy', [
    { key: 'in', type: 'fx.input', x: 40, y: 100 }, { key: 'blur', type: 'fx.blur', x: 280, y: 220, values: { radius: 14 } },
    { key: 'blend', type: 'fx.blend', x: 520, y: 100, values: { mode: 'screen', amount: 0.6 } }, { key: 'color', type: 'fx.colorAdjust', x: 760, y: 100, values: { brightness: 1.05, contrast: 0.95, saturation: 1.15, hue: 0 } },
    { key: 'out', type: 'fx.output', x: 1000, y: 100 },
  ], [['in', 'image', 'blend', 'a'], ['in', 'image', 'blur', 'image'], ['blur', 'image', 'blend', 'b'], ['blend', 'image', 'color', 'image'], ['color', 'image', 'out', 'image']]) },
  { id: 'oldfilm', label: 'preset.oldfilm', make: () => build('Old film', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'sepia', type: 'fx.sepia', x: 260, y: 80, values: { amount: 0.85 } },
    { key: 'noise', type: 'fx.noise', x: 260, y: 260, values: { scale: 3, speed: 8, colorA: 'rgba(0,0,0,0)', colorB: 'rgba(255,255,255,0.35)' } },
    { key: 'blend', type: 'fx.blend', x: 500, y: 80, values: { mode: 'overlay', amount: 0.5 } }, { key: 'vig', type: 'fx.vignette', x: 740, y: 80, values: { amount: 0.7, softness: 0.6 } },
    { key: 'out', type: 'fx.output', x: 980, y: 80 },
  ], [['in', 'image', 'sepia', 'image'], ['sepia', 'image', 'blend', 'a'], ['noise', 'image', 'blend', 'b'], ['blend', 'image', 'vig', 'image'], ['vig', 'image', 'out', 'image']]) },
  { id: 'wave', label: 'preset.wave', make: () => build('Heat wave', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'wave', type: 'fx.wave', x: 300, y: 80, values: { amplitude: 6, frequency: 18, speed: 3, direction: 'horizontal' } }, { key: 'out', type: 'fx.output', x: 580, y: 80 },
  ], [['in', 'image', 'wave', 'image'], ['wave', 'image', 'out', 'image']]) },
  { id: 'ripple', label: 'preset.ripple', make: () => build('Ripple', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'rip', type: 'fx.ripple', x: 300, y: 80 }, { key: 'out', type: 'fx.output', x: 580, y: 80 },
  ], [['in', 'image', 'rip', 'image'], ['rip', 'image', 'out', 'image']]) },
  { id: 'pulse', label: 'preset.pulse', make: () => build('Pulse', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'out', type: 'fx.output', x: 520, y: 80 },
    { key: 'osc', type: 'fx.oscillator', x: 40, y: 260, values: { frequency: 1, amplitude: 0.04, offset: 1 } },
    { key: 'dx', type: 'fx.drive', x: 300, y: 240, values: { prop: 'scaleX' } }, { key: 'dy', type: 'fx.drive', x: 300, y: 360, values: { prop: 'scaleY' } },
  ], [['in', 'image', 'out', 'image'], ['osc', 'value', 'dx', 'value'], ['osc', 'value', 'dy', 'value']]) },
  { id: 'spin', label: 'preset.spin', make: () => build('Spin', [
    { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'out', type: 'fx.output', x: 520, y: 80 },
    { key: 'time', type: 'fx.time', x: 40, y: 260, values: { speed: 1 } }, { key: 'mul', type: 'fx.math', x: 260, y: 260, values: { op: 'multiply', b: 45 } },
    { key: 'd', type: 'fx.drive', x: 500, y: 260, values: { prop: 'rotation' } },
  ], [['in', 'image', 'out', 'image'], ['time', 'value', 'mul', 'a'], ['mul', 'value', 'd', 'value']]) },
  { id: 'mood', label: 'preset.mood', make: () => {
    // Desaturates the layer as a variable goes down — a variable-driven effect.
    return build('Mood tint', [
      { key: 'in', type: 'fx.input', x: 40, y: 80 }, { key: 'var', type: 'fx.variable', x: 40, y: 240 },
      { key: 'map', type: 'fx.mapRange', x: 280, y: 240, values: { inMin: 0, inMax: 10, outMin: 0.2, outMax: 1.2 } },
      { key: 'adj', type: 'fx.colorAdjust', x: 520, y: 80 }, { key: 'out', type: 'fx.output', x: 780, y: 80 },
    ], [['in', 'image', 'adj', 'image'], ['var', 'value', 'map', 'value'], ['map', 'value', 'adj', 'saturation'], ['adj', 'image', 'out', 'image']]);
  } },
];
