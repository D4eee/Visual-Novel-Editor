# Speech Bubble

Example extension for Visual Novel Editor demonstrating **a custom layer type**.

- Registers the layer type `bubble` with its own property schema. The inspector, keyframe buttons, undo/redo, copy/paste and saving all work automatically from the schema.
- Transform properties (position, scale, rotation, opacity, anchor…) are added by the engine because the layer is `visual: true`.
- `size()` tells the canvas how big the layer is (for selection handles, hit-testing and effects); `draw()` paints it with Canvas 2D in the layer's local space.
- The animatable `pop` property drives a bouncy entrance – key it from 0 → 1.1 → 1 on the timeline.

Try it: in a scene, **Add layer → Speech bubble**, type some text, then add keyframes for *Pop*.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – `api.layers.register({ id, props, size, draw })`.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/speech-bubble`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
