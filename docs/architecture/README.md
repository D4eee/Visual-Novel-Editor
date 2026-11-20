# Architecture and design decisions

This document records the technology research, the chosen architecture, the information architecture of the editor, the main workflows, the data model, the extension design and the acceptance criteria used to verify the product.

## 1. Requirements that drive the design

1. A **standalone desktop editor** for macOS and Windows.
2. **Exported games** for macOS (`.app`) and Windows (`.exe`) that run without the editor — and should be exportable from either OS.
3. **One runtime** for editor preview and exported games, so the preview is trustworthy.
4. Rich 2D rendering: layers, keyframe animation, procedural effects with custom shaders, video and audio.
5. A **plugin system** that third parties can use without a toolchain, with editor and runtime parts, isolation and data preservation.
6. Complete English and Simplified Chinese interfaces.
7. Reproducible builds from source.

## 2. Technology research

| Option | Editor | Exported games | Assessment |
| --- | --- | --- | --- |
| **Electron + TypeScript** | Chromium UI, Node file access | Copy a prebuilt Electron runtime and add the game | Same engine (Chromium, V8, WebGL, codecs) on every platform; one language for editor, runtime and modules; export needs no compiler on the creator's machine; cross-platform export by copying the official runtime zip. Cost: ~90–110 MB per exported game, higher memory |
| Tauri (Rust + system webview) | Small binaries | Prebuilt runner + game | macOS uses WebKit, Windows WebView2: rendering, WebGL, video codecs and audio timing differ between platforms and from the editor; plugin code would need to target both engines. Smaller output (~10 MB) |
| Qt / C++ (or Rust native UI) | Native widgets | Native runner per platform | Best performance, but a scripting runtime for plugins must be embedded (Lua/JS), node-graph and timeline UIs are much more work, two languages for plugins (editor UI vs. runtime) |
| Godot-based (editor plugin / custom runner) | Godot editor UI | Godot export templates | Mature export, but the authoring UI is a game-engine UI rather than a writer's tool; plugin model is GDScript; export templates are large too |
| Ren'Py / existing VN engines | Script-first | Their own runtime | Do not offer the visual flow graph, composition, effect-graph and module requirements without forking |

**Decision: Electron + TypeScript.** The deciding factors are identical behaviour between preview and exported games on every platform, a single language and data model shared by editor, runtime and modules, plugins that are plain ES modules (no compiler needed), and exporting for macOS and Windows from either OS by assembling the official, checksum-verified Electron runtime with the game files. The size cost is acceptable for desktop games; a Web export is also offered for small distribution.

Supporting choices:

- **React 19** for the editor UI (large, interactive views with frequent updates), bundled with **esbuild** (fast, reproducible, no plugin chain).
- **Canvas 2D** for layers and compositing, **WebGL** only for shader-based effect nodes, **DOM overlays** for text boxes, menus and HUDs (crisp text, accessibility, CJK input).
- **Copy-on-write immutable project state** with structural sharing, which gives cheap undo/redo snapshots and simple change detection.
- **JSON project format** with a format version, migrations and stable ids, readable in version control.

## 3. Architecture

```
packages/core      Data model, graph rules, validation, migration, expressions, i18n, module manifests.
                   Pure TypeScript, no DOM: used by the editor, the runtime, the host and the tests.
packages/runtime   The game runtime: renderer, animation, effect-graph evaluator, script engine,
                   narrative UI, save/load, transitions, module host. Used by the editor's canvas
                   and preview AND bundled as player.js into exported games.
packages/host      Node side: project folders, autosave, backups, recovery, asset import,
                   module store, runtime templates, exporter. Exposed as an RPC "host API".
packages/desktop   Electron main process for the editor (window, menus, custom protocols, IPC
                   to the host API) and the tiny player shell used inside exported games.
packages/editor    React editor. Talks to the host only through the RPC API (IPC in Electron,
                   HTTP in browser mode for development and automated testing).
sdk                Public typings and helpers for module authors.
```

Key mechanisms:

- **Registries.** `Engine` holds registries for port types, node types, layer types, property extensions, interpolators, blocks, effect nodes, transitions, components, systems and functions. Built-ins are registered exactly like modules (with the reserved `core` owner); module ids are namespaced `<module id>/<local id>`, and every registration is owned so a module can be removed cleanly.
- **Story execution.** Flow ports carry execution; data ports are pull-evaluated (`ctx.input(port)`). Scene nodes have one output per choice (`c:<choiceId>`). Jump In nodes resolve to the Jump Out with the same number across chapters.
- **Rendering.** A scene is a flat list of layers with parent links. Each frame: animation clips are sampled, tweens and drivers applied, then layers are drawn with their transform; layers with effects are rendered into pooled buffers and passed through their effect graph.
- **Module host.** Validates manifests, checks engine/API compatibility, resolves dependencies, imports entry modules from their folder URL, wraps every registered function to catch and attribute errors, switches a module off after repeated errors, and rolls back registrations when activation fails.
- **Export.** Builds a game folder (strict CSP `index.html`, `player.js`, `game.js` with the stripped project, used assets only, runtime parts of used modules), then wraps it: macOS — rename `Electron.app`, patch `Info.plist`, add `.icns`, ad-hoc sign on macOS; Windows — rename `electron.exe`, add `.ico`, zip; Web — the folder itself.
- **Security.** The editor renderer runs with context isolation and no Node integration; file access goes through a whitelisted host API restricted to the open project, the module library and the editor's resources. Exported games load only bundled files through a custom protocol.

## 4. Information architecture of the editor

```
Home ─ New project · Open · Recent · Examples (copy as new / open) · Learn
Project window
├─ Top bar: project tabs · undo/redo · Preview (+ scope) · Export · Modules · Settings · Shortcuts · Language
├─ Left rail
│  ├─ Story: search · chapters (add, reorder, color) · nodes per chapter · All chapters
│  ├─ Assets: import · filter/search · preview · usage · missing/relink
│  ├─ Variables & characters: variables · characters + portraits · reusable behaviors · reusable compositions
│  └─ Module panels
├─ Workspace tabs
│  ├─ Chapter / All chapters: story flow graph
│  ├─ Scene: Composition (layers · canvas · inspector · dock: Timeline (keys, media, per-element effects) / Interactions (scripts + Test)) · Modules
│  ├─ Logic nodes: generated form · Modules
│  ├─ Reusable behavior: block workspace
│  └─ Module workspaces
├─ Inspector (right): selection-dependent
├─ Problems list (from the status bar)
└─ Preview panel: game view · scope · restart · debug (State / Path / Events / Errors)
Dialogs: New project · Project settings · Module manager · Export · Quick open · Shortcuts · Confirmations
```

## 5. Core workflows

1. **Plan** — create chapters; add scenes and logic nodes in the graph; connect; validate continuously.
2. **Write** — open a scene; write lines with speakers and portraits; add choice elements (each becomes an output); conditions and effects on choices.
3. **Stage** — import assets; drag onto the canvas; arrange layers; characters with portraits; compositions for reuse.
4. **Animate** — clips on the timeline; keyframes with record mode; curves; media clips.
5. **Polish** — effect graphs from presets; transitions; particles.
6. **Make interactive** — scripts on scenes (click, hover, keys, timers), reusable behaviors, Event nodes.
7. **Extend** — install modules; configure them in panels and node Modules tabs.
8. **Test** — preview by scene / chapter / game; inspect and edit variables; follow the path; read errors.
9. **Ship** — export with validation; macOS, Windows, Web.

## 6. Data model

`project.vne.json` (format `vne.project`, versioned):

- `settings` — title, author, identifier, version, resolution, window, text box style, title screen, default transition, icon.
- `chapters[]`, `nodes{}` (keyed by id: type, chapter, position, `data`, attached module `modules[]`), `edges[]` (`from {node, port}` → `to {node, port}`).
- Scene `data`: page number, background, `layers[]`, `animations[]` (tracks of keyframes, media clips), `dialogue[]`, `choices[]` (stable ids, condition, hidden, effects, animation), `scripts[]`, scene variables, transition, progression.
- `variables[]`, `characters[]` (+ portraits), `assets[]` (path, hash, kind, metadata, tags), `compositions[]`, `behaviors[]`, `effectGraphs[]`.
- `modules[]` (dependencies with version ranges and enabled flags), `extensions{}` (module-owned project data), `editor` (view state; stripped on export).

Everything references other things by id, so renaming never breaks references. Unknown node/layer/block types and unknown fields are preserved verbatim.

## 7. Extension design

See the [modding guide](../modding/README.md). Extension points: story nodes and port types; layer types; property extensions; interpolators; effect nodes; transitions; script blocks; node components (module data attached to a node, with optional custom node workspace UI); systems (playthrough-long state with save/load); expression functions; editor panels, inspectors, node workspaces, workspaces, toolbar buttons, importers and exporters.

## 8. Acceptance criteria

The product is accepted when, in the built application:

| Area | Criterion |
| --- | --- |
| Projects | Create, open, save, reopen; autosave; recovery after an unsaved stop; backups; multiple projects/windows |
| Story graph | Add/connect/disconnect/move/copy/paste/delete nodes; chapters; per-choice outputs survive reorder/rename; conditions; cross-chapter jumps; endings; validation with navigation |
| Scenes | Import assets; drag to canvas; transform with handles; layer types listed above; dialogue with speakers and portraits; choices with conditions and effects |
| Animation | Keyframes on any animatable property, record mode, interpolation incl. Bezier, media clips |
| Effects | Presets, node editing, typed connections, parameters, drivers, shaders, shared effects |
| Scripting | The scripted example (click character → animation → change relationship → wait → reveal choice) works in preview and export |
| Modules | Install from file/folder; enable/disable/remove; configure; data preserved when missing; errors isolated; included in export |
| Preview | Scene/chapter/game scopes; debug state, path, events, errors; same runtime as export |
| Export | Validation gate; web build runs in a browser; macOS app and Windows exe structure with metadata and icons |
| Languages | Complete English and Simplified Chinese interface, switchable at runtime |
| Reliability | Undo/redo for every edit; stable ids; format versioning; no data loss on missing modules |

## 9. Verification performed

- **Automated tests** (`npm test`, 20 tests): copy-on-write state and history; graph rules (connections, per-choice ports, copy/paste, cross-chapter jumps, validation); unknown-module data preservation and format versioning; expressions and semver; loading all example modules, error isolation and rollback; the example game validating with its modules; zip round trips (modes, symlinks, path-escape protection); save/backup/autosave recovery; asset de-duplication and missing files; export of the example game to Web, macOS and Windows (with mock runtime templates); module packaging and installation.
- **End-to-end checks in a browser build of the editor** (Chromium, scripted): creating a project from the example; opening chapters and scenes; the full playthrough of *Like Human* in the preview (click-to-reveal choice, notifications, cross-chapter jump, title card composition, timed choices, video layer, ending); the export dialog and a Web export; playing the exported Web build; module inspector and composition editing.
- **Not verifiable in the build environment:** launching the Electron editor and the exported `.app` / `.exe` (no macOS/Windows desktop available). The packaging steps are covered by tests with mock templates; the release build must be produced and smoke-tested on a Mac and a Windows PC (`npm run dist:mac` / `npm run dist:win`, see [build-and-release.md](build-and-release.md)).
