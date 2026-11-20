import { Engine } from '@vne/core';
import { registerBuiltinBasics } from './builtins/basics';
import { registerBuiltinNodes } from './builtins/nodes';
import { registerBuiltinLayers } from './builtins/layers';
import { registerBuiltinBlocks } from './builtins/blocks';
import { registerBuiltinEffects } from './builtins/effects';

/** Create an engine with every built-in node, layer, block, effect, interpolator and transition registered. */
export function createEngine(): Engine {
  const engine = new Engine();
  registerBuiltinBasics(engine);
  registerBuiltinNodes(engine);
  registerBuiltinLayers(engine);
  registerBuiltinBlocks(engine);
  registerBuiltinEffects(engine);
  return engine;
}

export * from './math';
export * from './animation';
export * from './assets';
export * from './effects';
export * from './render';
export * from './text';
export * from './stage';
export * from './narrative';
export * from './state';
export * from './script';
export * from './scene';
export * from './game';
export * from './modules';
export * from './editview';
export { TRANSFORM_PROPS, portraitAsset, regionPoints, regionContains, regionPath } from './builtins/layers';
export { varNameFn } from './builtins/nodes';
export { runtimeStrings } from './strings';
