# Timed Choices

Example extension for Visual Novel Editor demonstrating **a node module with its own editor interface and runtime behavior**.

- `api.components.register` (runtime.js) defines the **Timed choices** module that can be attached to scene nodes. Its hooks (`sceneEnter`, `frame`, `sceneExit`) receive the instance's saved data and a private `state` object.
- At runtime it listens for `dialogue.end`, shows a countdown bar in the HUD and calls `ctx.scene.pickChoice()` when time runs out.
- `api.nodeWorkspaces.register` (editor.js) replaces the generated form with a custom UI inside the scene node's **Modules** workspace. It reads the node's choices so the default-choice picker always matches the scene, and writes with `ctx.setData()` (undoable).
- `validate()` warns when the scene has no choices or the default choice was deleted.

Try it: open a scene that has choices, go to **Modules → Add module → Timed choices**, then preview the scene.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – `api.components.register`; editor.js – `api.nodeWorkspaces.register`, `h()` and `ui.*` from the SDK.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/timed-choices`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
