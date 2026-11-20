# Retro FX

Example extension for Visual Novel Editor demonstrating **custom procedural effect nodes (Canvas 2D and GLSL) and a transition**.

- **CRT scanlines** – a Canvas 2D node. Image values are canvases; scratch canvases come from `ctx.pool` so nothing is allocated per frame. `animated: true` re-evaluates it every frame.
- **Posterize** – a GLSL fragment shader run with `ctx.shaders.run(pool, source, image, uniforms, time)`. Shaders receive `u_image`, `u_size`, `u_time` and `uv`.
- **Pixel dissolve** – a scene transition. `draw(ctx, from, to, progress, params)` composes the outgoing and incoming frames.

Try it: select a layer, open **Effects**, create an effect graph and add *CRT scanlines* between *Layer image* and *Output*. Pick *Pixel dissolve* as a scene's transition in the Scene inspector.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – `api.effects.register`, `api.transitions.register`.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/retro-fx`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
