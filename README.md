<p align="center">
  <img src="resources/icons/app.png" width="112" alt="Visual Novel Editor">
</p>

<h1 align="center">Visual Novel Editor</h1>

<p align="center">
  Build branching stories. Compose each scene. Bring your world to life.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/D4eee/Visual-Novel-Editor/releases/latest">Download</a> ·
  <a href="docs/user-guide/README.md">User guide</a> ·
  <a href="docs/release-notes/v0.3.1.md">Release notes</a> ·
  <a href="docs/modding/README.md">Module development</a>
</p>

---

Visual Novel Editor is a standalone authoring tool for visual novels and interactive stories. Plan routes in a story graph, compose scenes with layers, animate elements on a timeline, and build interactions with visual scripting—all in one workspace.

The editor is available for **macOS, Windows, and Linux**, with **English and Simplified Chinese** interfaces. Export your game for the **web, macOS, or Windows**, so players can run it without the editor.

## A complete storytelling workspace

| Workspace | What you can create |
| --- | --- |
| **Story graph** | Organize chapters, connect scenes and choices, and build conditions, events, weighted random branches, waits, jumps, and endings. View one chapter or the whole story. |
| **Scene composition** | Arrange backgrounds, character portraits, images, text, dialogue, shapes, buttons, hotspots, audio, and video. Use groups and reusable compositions to organize scenes. |
| **Dialogue design** | Place dialogue boxes freely, create speech and thought bubbles, customize typography and appearance, import fonts, and add typewriter reveals. |
| **Timeline animation** | Animate element properties with keyframes and editable interpolation curves. Coordinate motion with audio, video, and effects. |
| **Procedural effects** | Build effects with node graphs, including blur, color adjustments, distortion, noise, and custom GLSL shaders. Save, reuse, and share presets as `.vnefx` files. |
| **Visual scripting** | Connect triggers, actions, values, and conditions with Scratch-style blocks. Add clickable regions, control elements and media, create reusable behaviors, and trace execution in Test mode. |
| **Game systems** | Keep music, looping animations, and scripts running between pages. Use global elements for HUDs and inventories, animate sprites, track parameters and lists, and unlock choices with collected items. |
| **Preview and export** | Preview a scene, chapter, or complete game with the same runtime used in exported games. Inspect variables and execution logs, then export only the assets and runtime modules your game uses. |

Projects also support **autosave, recovery, backups, undo/redo, and versioned data migration**. Validation helps locate broken routes, missing assets, and other issues before export.

## Download and launch

Get the ready-to-run editor from [GitHub Releases](https://github.com/D4eee/Visual-Novel-Editor/releases/latest). Desktop builds do not require a separate Node.js installation.

| Your system | Download |
| --- | --- |
| macOS · Apple silicon | `Visual-Novel-Editor-<version>-mac-arm64.zip` |
| macOS · Intel | `Visual-Novel-Editor-<version>-mac-x64.zip` |
| Windows · x64 | `Visual-Novel-Editor-<version>-win-x64.zip` |
| Linux · x64 | `Visual-Novel-Editor-<version>-linux-x64.zip` |

**macOS:** Extract the archive and move `Visual Novel Editor.app` to Applications. The distributed app is not Apple-notarized. For a build you trust, the existing first-launch procedure is:

```bash
xattr -cr "/Applications/Visual Novel Editor.app"
codesign --force --deep --sign - "/Applications/Visual Novel Editor.app"
```

**Windows:** Extract the archive and open `Visual Novel Editor.exe`.

**Linux:** Extract the archive and run `visual-novel-editor`.

Release assets include `SHA256SUMS.txt` for verifying downloads. The current **v0.3.1** release includes four desktop archives; a web editor archive is not attached to that release. To use the editor in a browser, [run it from source](#development) with Node.js 20 or later.

> **Editor platforms and game export targets are different.** The Linux download runs the editor; the documented game export targets are web, macOS, and Windows.

## Your first story

1. **Create a project**, or open a copy of an included example.
2. **Write and connect scenes** in the story graph, with a separate output for each choice.
3. **Build each scene** with images, characters, dialogue, sound, and interactive elements.
4. **Add motion and behavior** using the timeline, effect graphs, and visual scripting.
5. **Preview, resolve validation errors, and export** your game.

Follow the [getting-started tutorial](docs/user-guide/getting-started.md) for a small story with two routes. For the Chinese tutorial, switch to the [Chinese README](README.zh-CN.md).

## What's new in 0.3.1

- **Freely positioned dialogue boxes:** Custom shapes, speech and thought bubbles, styling, typewriter reveals, keyframe transforms, and dialogue-related scripting blocks.
- **Custom fonts:** Import TTF, OTF, WOFF, or WOFF2 fonts for the canvas, previews, and exported games.
- **A docked console:** Review issues grouped by node, filter by severity or text, and resize the console.
- **Clearer preview controls:** The Preview button becomes a red Stop button while a preview is running.
- **Start-screen improvements:** Manage recent projects from a context menu and browse examples in a scrollable icon grid.
- **A scripting layout fix:** Wrapped block labels no longer overlap adjacent blocks.

Read the [complete release notes](docs/release-notes/v0.3.1.md). The README describes the current source; release notes describe changes in that published version.

## Documentation

| I want to… | Start here |
| --- | --- |
| Make my first story | [Getting started](docs/user-guide/getting-started.md) |
| Learn the editor | [User guide](docs/user-guide/README.md) |
| Export a playable game | [Export guide](docs/user-guide/export.md) |
| Build a module | [Module development](docs/modding/README.md) |
| Look up SDK interfaces | [API reference](docs/api/README.md) |
| Understand the codebase | [Architecture](docs/architecture/README.md) |
| Build or package the editor | [Build and release](docs/architecture/build-and-release.md) |

See the [documentation index](docs/README.md) for an overview.

## Extend the editor

Modules can add story nodes, scene elements, properties, effects, transitions, scripting blocks, systems, panels, workspaces, importers, and exporters. A module can extend the runtime, the editor, or both.

The repository includes a **module SDK, a starter template, and seven example modules**. Project data belonging to a missing module is preserved, so reopening a project without an extension does not discard that extension's data.

## Development

Requires **Node.js 20 or later**.

```bash
npm install
npm start
```

`npm start` builds and opens the Electron desktop editor. To run the browser editor instead:

```bash
npm run serve
```

Open `http://127.0.0.1:5199`.

<details>
<summary><strong>Checks, packaging, and repository layout</strong></summary>

### Checks

```bash
npm run typecheck
npm run check-i18n
npm test
```

### Packaging

| Command | Output |
| --- | --- |
| `npm run app:mac` | Desktop app for the current Mac |
| `npm run app:win` | Windows x64 desktop archive |
| `npm run app:web` | Browser editor package; requires a local Node.js server |
| `npm run dist:mac` | macOS installer packages with electron-builder |
| `npm run dist:win` | Windows installer and ZIP archive |

Packaging downloads the Electron runtime templates used for game exports, verifies their checksums, and bundles them with the editor. See [Build and release](docs/architecture/build-and-release.md) for cross-platform packaging and signing details.

### Repository layout

| Path | Purpose |
| --- | --- |
| `packages/core` | Data model, story graph rules, validation, migration, expressions, and localization |
| `packages/runtime` | Shared game runtime for preview and exported games |
| `packages/host` | File access, project management, assets, modules, and export |
| `packages/desktop` | Electron shells for the editor and exported games |
| `packages/editor` | React editor interface |
| `sdk` | Module SDK types and helpers |
| `examples/games` | Example projects available as editor templates |
| `examples/extensions` | Seven example modules |
| `templates/extension` | Starter module template |
| `docs` | Guides, release notes, API documentation, and architecture notes |

</details>

## License

MIT
