# Visual Novel Editor

A standalone, extensible visual novel engine for macOS and Windows: a story flow graph, layered scene composition, keyframe animation, procedural effect graphs, Scratch-style visual scripting, a module SDK, and one-click export of games as a macOS `.app` or a Windows `.exe`.

[中文快速上手](docs/user-guide/getting-started.zh-CN.md) · [User guide](docs/user-guide/README.md) · [Modding guide](docs/modding/README.md) · [API reference](docs/api/README.md) · [Architecture](docs/architecture/README.md)

## Features

- **Story flow graph** – Start, Scene/Page (one output per choice, with stable choice ids), Event, Condition, Jump In / Jump Out pairs (also across chapters), Random, Wait, Ending and Comment nodes; chapters; validation with a Problems list.
- **Scene composition** – canvas with backgrounds, images, characters (portraits), text, shapes, buttons, hotspots, video, audio, groups, reusable compositions, particles and module-defined layers.
- **Timeline** – keyframes on any animatable property, interpolation curves with a curve editor, audio/video clips synced to the timeline.
- **Procedural effects** – node-based effect graphs per layer (blur, color, distortion, noise, custom GLSL shaders, property drivers), shared effect graphs and presets.
- **Visual scripting** – event blocks (clicks, scene start, dialogue, choices, variables), control, looks, sound, variables and story blocks; reusable behaviors.
- **Modules** – runtime, editor or combined modules that add nodes, layers, properties, effects, transitions, blocks, systems, panels, node workspaces, importers and exporters. Unknown module data is preserved when a module is missing.
- **Preview** – the same runtime as exported games, scoped to a scene, a chapter or the whole game, with a debug panel (variables, flow, log).
- **Export** – game folder, web build, macOS app and Windows executable; only used assets and runtime modules are included.
- **Reliability** – stable ids, versioned file format with migration, autosave, crash recovery, backups, undo/redo.
- **Languages** – complete English and Simplified Chinese interface.

## Run from source

Requires Node.js 20+.

```bash
npm install
npm start            # build and launch the desktop editor (Electron)
npm run serve        # or: run the editor in a browser at http://127.0.0.1:5199
npm test             # unit tests
```

## Build the editor

```bash
npm run dist:mac     # on macOS → release/*.dmg, *.zip (arm64 + x64)
npm run dist:win     # on Windows → release/*.exe installer and zip
```

`dist` downloads the Electron runtimes used as templates for exported games (checked against Electron's SHA256 sums) and ships them inside the editor, so exporting games works offline. See [docs/architecture/build-and-release.md](docs/architecture/build-and-release.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/core` | Data model, graph rules, validation, migration, expressions, i18n (no DOM) |
| `packages/runtime` | Game runtime shared by preview and exported games: renderer, animation, effects, scripts, UI |
| `packages/host` | File system, projects, assets, modules, export (Node) |
| `packages/desktop` | Electron shell for the editor and for exported games |
| `packages/editor` | The editor UI (React) |
| `sdk` | Module SDK: typings and helpers |
| `examples/games` | Example game projects (available as templates in the editor) |
| `examples/extensions` | Seven example modules covering every extension point |
| `templates/extension` | Starter template for new modules |
| `docs` | User guide, modding guide, API reference, architecture notes |

## License

MIT
