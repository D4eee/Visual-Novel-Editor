# Relationships

Example extension for Visual Novel Editor demonstrating **a complete gameplay system with editor and runtime parts**.

- **System** (`api.systems.register`) – created once per playthrough. It keeps affection values, draws a heart meter in the HUD, and implements `save()`/`load()` so values are stored in save slots.
- **Blocks** – *Change affection of … by …* and the hat *When affection of … reaches …* (fired by the `affection.changed` event the system dispatches).
- **Story node** – *Affection Branch* with *High* / *Low* outputs.
- **Scene module** – *Affection on enter*, attachable to scenes (several per scene).
- **Expression function** – `affection("Mika") >= 5` in any condition.
- **Exporter** (editor.js, `api.exporters.register`) – *Export → Other exports → Affection report* downloads a Markdown list of every place that reads or changes affection.
- **Editor panel** (editor.js, `api.panels.register`) – a sidebar panel that stores settings in `project.extensions["com.example.relationships"]` through undoable `ctx.update()` calls. The settings are exported with the game.

Try it: install the module, open **Relationships** in the left sidebar, enable tracking for a character, then use the block or node in your story. The example game *Like Human* uses this module.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – systems, blocks, nodes, components, functions; editor.js – `api.panels.register`, `api.exporters.register`.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/relationships`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
