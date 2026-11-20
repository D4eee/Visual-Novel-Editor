# Wobble & Float

Example extension for Visual Novel Editor demonstrating **custom animated properties and a custom interpolation curve**.

- `api.properties.register` adds **Wobble** and **Float** to every visual layer (`layerTypes: '*'`). They appear in the inspector under *Motion extras* with keyframe buttons and can be animated on the timeline, set from scripts or driven from effect graphs.
- `phase: 'transform'` runs the `apply` hook before the layer is drawn so it can bend the layer's local transform. `rc.time` is the scene clock and `rc.width/height` the layer's size.
- `api.interpolators.register` adds *Smoother step* to the keyframe interpolation menu.

Try it: select a character layer and set *Float* to 12. Then key *Wobble* 0 → 1 → 0 over one second.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – `api.properties.register`, `api.interpolators.register`.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/wobble`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
