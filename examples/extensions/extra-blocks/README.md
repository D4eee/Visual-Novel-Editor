# Extra Blocks

Example extension for Visual Novel Editor demonstrating **custom visual scripting blocks and an expression function**.

- **With N % chance** – a C-shaped block; its body runs via `ctx.runBody(block.body)`.
- **Show notification … for … s** – a statement block that awaits `ctx.wait()` (cancelled automatically when the scene ends).
- **When … reaches …** – a hat block that listens to the runtime event `var.changed` and filters it with `matches()`.
- `randomFloat(a, b)` – an expression function usable in conditions and *Set variable* blocks.

Labels are templates: `{percent}` is replaced by the editor input for the argument with id `percent`.

Try it: open a scene's **Scripts** tab – the new blocks appear in the Control, Looks and Events categories with a purple color.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – `api.blocks.register`, `api.functions.register`.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/extra-blocks`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
