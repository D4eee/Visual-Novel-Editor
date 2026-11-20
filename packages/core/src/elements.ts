import type { Choice, DialogueLine, Layer, SceneData } from './types';

/**
 * Dialogue and choices are scene elements (layers):
 * - one `core.dialogue` layer holds the scene's lines (shown in the text box);
 * - every `core.choice` layer is one choice: a button on the canvas and one
 *   output port (`c:<layer id>`) of the scene node.
 */
export const DIALOGUE_LAYER = 'core.dialogue';
export const CHOICE_LAYER = 'core.choice';

/** Visual defaults of a choice button (also used by the format migration). */
export const CHOICE_STYLE = {
  width: 560, height: 60, fontSize: 24, textColor: '#ffffff',
  fill: 'rgba(18,20,32,0.86)', hoverFill: '#5b5ff0', borderColor: 'rgba(255,255,255,0.22)', radius: 12,
};

export function dialogueLayer(d: SceneData): Layer | undefined {
  return d.layers.find((l) => l.type === DIALOGUE_LAYER);
}

export function sceneLines(d: SceneData): DialogueLine[] {
  const l = dialogueLayer(d);
  return (Array.isArray(l?.props.lines) ? l!.props.lines : []) as DialogueLine[];
}

/** Choice layers in reading order (top to bottom, then left to right). */
export function choiceLayers(d: SceneData): Layer[] {
  return d.layers.filter((l) => l.type === CHOICE_LAYER)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (Number(a.l.props.y) || 0) - (Number(b.l.props.y) || 0) || (Number(a.l.props.x) || 0) - (Number(b.l.props.x) || 0) || a.i - b.i)
    .map((x) => x.l);
}

export function choiceOf(l: Layer): Choice {
  const p = l.props || {};
  return {
    id: l.id,
    text: String(p.text ?? ''),
    condition: p.condition ?? null,
    hidden: !!p.hidden,
    unavailable: p.unavailable === 'disable' ? 'disable' : 'hide',
    effects: Array.isArray(p.effects) ? p.effects : [],
    animationId: p.animationId ?? null,
  };
}

export function sceneChoices(d: SceneData): Choice[] {
  return choiceLayers(d).map(choiceOf);
}
