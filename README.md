# Visual Novel Editor — Web edition

> Branch `web`: the editor runs in your web browser, served by a small local Node.js server (no Electron). The desktop app is on the [`desktop`](https://github.com/D4eee/Visual-Novel-Editor/tree/desktop) branch; the full source and history are on [`main`](https://github.com/D4eee/Visual-Novel-Editor/tree/main).

A standalone, extensible visual novel engine for macOS and Windows: a story flow graph, layered scene composition, keyframe animation, procedural effect graphs, Scratch-style visual scripting, a module SDK, and one-click export of games as a macOS `.app` or a Windows `.exe`.

[中文快速上手](docs/user-guide/getting-started.zh-CN.md) · [User guide](docs/user-guide/README.md) · [Modding guide](docs/modding/README.md) · [API reference](docs/api/README.md) · [Architecture](docs/architecture/README.md)

## Features

- **Story flow graph** – Start, Scene/Page (one output per choice, with stable choice ids), Event, Condition, Jump In / Jump Out pairs (also across chapters), Random, Wait, Ending and Comment nodes; chapters; validation with a Problems list.
- **Scene composition** – everything in a scene is an element: backgrounds, images, characters (portraits), text, free dialogue boxes (any shape, speech and thought bubbles, typewriter), shapes, buttons, hotspots, video, audio, the dialogue, choice buttons, groups, reusable compositions, particles and module-defined layers. Upload your own fonts.
- **Timeline** – keyframes on any animatable property of any element, interpolation curves with a curve editor, audio/video clips, and each element's effects.
- **Procedural effects** – node-based effect graphs per element (full-screen effects via a covering mask); save your own effects as presets, reuse them across projects and share them as `.vnefx` files (blur, color, distortion, noise, custom GLSL shaders, property drivers), shared effect graphs and presets.
- **Interactions (visual scripting)** – Scratch-like blocks on a pan/zoom canvas: triggers, actions, nestable values and conditions (operators, sensing, variables). Elements and scripts are bound together: every element gets its own blocks, elements drop into slots like variables, media and other elements can be created right from Interactions, detection areas (rectangle, ellipse, polygon) answer *mouse inside?*; a Test run lights up blocks as they execute; reusable behaviors.
- **Game module** – pages inherit what is still running (music, looping animations, running scripts; *when the page changes, remove / pause* decides); a global page for elements on every page (BGM, HUD, inventory, health); sprites with a frame editor; element parameters; list variables and on-screen labels; transform blocks; collectibles that unlock choices and paths.
- **Modules** – runtime, editor or combined modules that add nodes, layers, properties, effects, transitions, blocks, systems, panels, node workspaces, importers and exporters. Unknown module data is preserved when a module is missing.
- **Preview** – the same runtime as exported games, scoped to a scene, a chapter or the whole game, with a debug panel (variables, flow, log).
- **Export** – game folder, web build, macOS app and Windows executable; only used assets and runtime modules are included.
- **Reliability** – stable ids, versioned file format with migration, autosave, crash recovery, backups, undo/redo.
- **Languages** – complete English and Simplified Chinese interface.

## Download

Ready-made builds are attached to the [GitHub releases](https://github.com/D4eee/Visual-Novel-Editor/releases):

| Edition | File | Needs |
| --- | --- | --- |
| **Desktop – macOS (Apple Silicon)** | `Visual-Novel-Editor-<version>-mac-arm64.zip` | nothing else |
| **Desktop – macOS (Intel)** | `Visual-Novel-Editor-<version>-mac-x64.zip` | nothing else |
| **Desktop – Windows (x64)** | `Visual-Novel-Editor-<version>-win-x64.zip` | nothing else |
| **Web** (editor in your browser) | `Visual-Novel-Editor-<version>-web.zip` | Node.js 20+ |

The desktop editions are complete applications: example games, the seven example modules and the runtimes for exporting macOS/Windows games are built in, so everything works offline. They are not notarized: on a Mac, unzip, move *Visual Novel Editor.app* to Applications and run once in Terminal

```bash
xattr -cr "/Applications/Visual Novel Editor.app" && codesign --force --deep --sign - "/Applications/Visual Novel Editor.app"
```

(builds made with `npm run app:mac` on your own Mac are signed automatically). On Windows, unzip and run *Visual Novel Editor.exe*.

### Branches

| Branch | Contents |
| --- | --- |
| `main` | Full source of both editions, development history |
| `desktop` | The desktop edition: source and packaging for the Electron app |
| `web` | The web edition: source and packaging for the browser editor (local Node server) |

## Run from source

Requires Node.js 20+.

```bash
npm install
npm start            # build and open the editor at http://127.0.0.1:5199
npm test             # unit tests
```

## Build the editor

```bash
npm run app:web      # → release/Visual-Novel-Editor-<version>-web.zip (runs with Node.js only)
```

Exporting macOS/Windows games downloads the Electron runtimes used as templates for exported games (checked against Electron's SHA256 sums) and ships them inside the editor, so exporting games works offline. See [docs/architecture/build-and-release.md](docs/architecture/build-and-release.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/core` | Data model, graph rules, validation, migration, expressions, i18n (no DOM) |
| `packages/runtime` | Game runtime shared by preview and exported games: renderer, animation, effects, scripts, UI |
| `packages/host` | File system, projects, assets, modules, export (Node) |
| `packages/desktop` | Electron shell for exported games (player) |
| `packages/editor` | The editor UI (React) |
| `sdk` | Module SDK: typings and helpers |
| `examples/games` | Example game projects (available as templates in the editor) |
| `examples/extensions` | Seven example modules covering every extension point |
| `templates/extension` | Starter template for new modules |
| `docs` | User guide, modding guide, API reference, architecture notes |

## License

MIT
