# Modding guide

Modules extend Visual Novel Editor without changing the engine. Everything built into the editor — story nodes, layers, script blocks, effect nodes — is registered through the same registries that modules use, so modules are first-class.

- [Getting started](getting-started.md) — your first module in 15 minutes ([中文](getting-started.zh-CN.md))
- [Manifest, packaging and distribution](manifest.md)
- [Runtime extensions](runtime.md) — nodes, ports, layers, properties, interpolators, effect nodes, transitions, blocks, node modules (components), systems, functions
- [Editor extensions](editor.md) — panels, inspectors, node workspaces, workspaces, toolbar buttons, importers, exporters
- [Data, compatibility and safety](compatibility.md) — ids, saved data, versions, missing modules, error isolation
- [Testing and debugging](testing.md)
- [API reference](../api/README.md)

## What a module is

A module is a folder (or a `.vnemod` zip of that folder):

```
my-module/
  module.json        manifest: id, version, compatibility, entry points
  runtime.js         optional: runs in the editor preview AND in exported games
  editor.js          optional: runs only in the editor (never exported)
  locales/en.json    UI strings (any number of languages)
  locales/zh-CN.json
  assets/…           optional files, reached with api.assetUrl('assets/…')
```

| Kind | Entry points | Example |
| --- | --- | --- |
| **runtime** | `runtime.js` | a layer type, effect nodes, blocks |
| **editor** | `editor.js` | an importer, a project statistics panel |
| **combined** | both | a gameplay system with a configuration panel |

Entries are plain ES modules — no build step, no bundler. Write them in JavaScript (with `// @ts-check` and the SDK typings for autocompletion) or compile TypeScript to a single file.

## The seven examples

[`examples/extensions`](../../examples/extensions) contains one complete module for each extension point. Read them side by side with this guide:

| Module | Shows |
| --- | --- |
| `dice-check` | Custom story nodes, a custom port type, data connections |
| `speech-bubble` | A custom layer type |
| `wobble` | Custom animated properties and an interpolation curve |
| `retro-fx` | Custom effect nodes (Canvas 2D and GLSL) and a transition |
| `extra-blocks` | Custom script blocks and an expression function |
| `timed-choices` | A node module with its own editor interface and runtime behavior |
| `relationships` | A gameplay module: system with save data, HUD, blocks, story node, scene module, editor panel |

Start new modules from [`templates/extension`](../../templates/extension).
