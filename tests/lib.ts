// Everything the tests need from the source tree, bundled by scripts/build.mjs into dist/test/vne.mjs.
export * from '@vne/core';
export { createEngine, ModuleHost } from '@vne/runtime';
export * as zip from '../packages/host/src/zip';
export * as projects from '../packages/host/src/projects';
export * as exporter from '../packages/host/src/exporter';
export { ModuleStore } from '../packages/host/src/modules';
export { TemplateStore, templateName } from '../packages/host/src/templates';
export { importAssets, missingAssets } from '../packages/host/src/assets';
