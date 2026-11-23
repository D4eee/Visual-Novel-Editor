# Developing Visual Novel Editor — a guide for AI agents

> **中文说明：**本文写给要修改或扩展本程序的 AI（以及开发者）。读完后应能知道代码在哪里、数据怎么流动、加一个新功能要改哪些文件，以及提交前必须跑哪些检查。使用软件制作作品，请看 [USING.md](USING.md)。

This document describes Visual Novel Editor **1.1.1** (project format 5, module API 1.5). It is written so that an AI coding agent can start changing the program safely within one read: where things live, how data flows, the recipes for common changes, and the checks to run before committing.

For how to *use* the editor to make a game, read [USING.md](USING.md). Longer background: [architecture](../architecture/README.md), [build and release](../architecture/build-and-release.md), [modding guide](../modding/README.md), [API reference](../api/README.md).

---

## 1. What the program is

A desktop (Electron) and browser editor for branching visual novels, plus the game runtime that plays them.

- **Authoring:**
  - a story graph of chapters, scenes and logic nodes;
  - scene composition with layers;
  - an After Effects-style timeline (keyframes, expressions, precompositions);
  - Scratch-style block scripts;
  - effect graphs (shaders).
- **Game runtime:** one runtime renders the editor canvas, the preview, and exported games for macOS, Windows, Linux and the web.
- **Extensibility:** built-ins are registered through the same registries as third-party **modules**.
- **Extras:**
  - AI assistant (Claude or OpenAI-compatible, with MCP-style tools);
  - image generation;
  - translations;
  - script import;
  - English and Simplified Chinese UI.

Tech: TypeScript everywhere, React 19 editor, esbuild bundling, Canvas 2D rendering (WebGL only for shader effects), immutable copy-on-write project state, JSON project files.

---

## 2. Repository map

```
packages/
  core/       Pure TS (no DOM). Data model, registries, graph rules, validation, migrations,
              expressions, history (undo), i18n helpers, localization, script parser.
  runtime/    The game engine: rendering, animation, scenes, game loop, UI (save/load, log,
              settings), script engine, built-in node/layer/block/effect definitions.
              Used by the editor canvas + preview AND bundled into exported games as player.js.
  host/       Node side. File system, projects, assets, module store, exporter, AI and image
              service proxies. Exposed as an RPC "host API" (api.ts).
  desktop/    Electron main/preload for the editor, and the tiny player shell of exported games.
  editor/     React editor UI. Talks to the host only through the RPC API (host.ts `call`).
sdk/          Public typings (sdk/types/index.d.ts) and helpers for module authors.
templates/    New-module template (templates/extension).
examples/     games/like-human (uses every feature), extensions/* (example modules).
tests/        node:test suites; tests/lib.ts re-exports what tests need (bundled to dist/test/vne.mjs).
scripts/      build.mjs, package-desktop.mjs, package-web.mjs, check-i18n.mjs, gen-api-docs.mjs …
docs/         user-guide/, modding/, architecture/, api/ (generated), release-notes/, ai/ (this).
resources/    icons, runtime templates for export.
```

Path aliases: `@vne/core`, `@vne/runtime` (see `tsconfig.json`). Build output goes to `dist/` (`dist/editor`, `dist/player`, `dist/desktop`, `dist/server.js`, `dist/test/vne.mjs`).

### Key files

| Area | File | What it holds |
| --- | --- | --- |
| Data model | `core/src/types.ts` | `Project`, `StoryNode`, `SceneData`, `Layer`, `AnimationClip`, `Track`, `Keyframe`, `Character`, `Asset`, `Composition`, `ScriptStack`/`Block` … |
| Defaults / versions | `core/src/defaults.ts` | `ENGINE_VERSION`, `API_VERSION`, `createProject`, `createNode`, `createLayer`, `newId`, `GLOBAL_NODE_ID` |
| Format + migrations | `core/src/types.ts` (`PROJECT_FORMAT_VERSION`), `core/src/migrate.ts` | Every format bump adds a `{ from, describe, run }` step |
| Registries | `core/src/registry.ts` | `Engine` with `nodeTypes`, `layerTypes`, `blocks`, `interpolators`, `transitions`, `effectNodes`, … `PropDef`, `PropType`, `LayerTypeDef`, `BlockDef` |
| Graph rules | `core/src/graph.ts` | `nodePorts`, `connect`, `choicePort` (`c:<choiceId>`), `SCENE_DEFAULT_PORT` (`next`), `syncSceneChoiceEdges`, `startNode` |
| Elements helpers | `core/src/elements.ts` | `sceneLines`, `sceneChoices`, `choiceLayers`, `DIALOGUE_LAYER`, `CHOICE_LAYER` |
| Validation | `core/src/validate.ts` | Problems shown in the status bar / problems panel |
| Undo | `core/src/history.ts` | Snapshot `History<T>`: `update(label, recipe, {mergeKey})`, `undo`, `redo`, `steps()`, `go(n)` |
| Immutable updates | `core/src/produce.ts` | `produce(state, draft => …)` (Immer-like, structural sharing) |
| Translations | `core/src/localize.ts` | `collectTexts`, `localizeProject`, keys like `line:<id>`, `choice:<id>`, `prop:<layer>:<key>` |
| Script format | `core/src/scriptImport.ts` | `parseScript`, `sceneToScript` |
| Page inheritance | `core/src/inherit.ts` | What continues from one scene ("page") to the next; global page |
| Built-in nodes | `runtime/src/builtins/nodes.ts` | `core.start/scene/event/condition/random/wait/jumpIn/jumpOut/ending/comment` |
| Built-in layers | `runtime/src/builtins/layers.ts` (+ `freeDialogue.ts`, `game.ts`) | background, image, character, text, **textbox**, shape, button, dialogue, choice, hotspot, video, audio, group, composition, particles, sprite, inventory, freeDialogue |
| Built-in blocks | `runtime/src/builtins/blocks.ts`, `game.ts` | ~150 Scratch-style blocks (events, control, looks, sound, sensing, operators, variables, story, lists, sprites, items) |
| Easing / transitions | `runtime/src/builtins/basics.ts` | interpolators `linear step easeIn easeOut easeInOut backOut elastic bounce bezier`; transitions `none fade dissolve slide` |
| Animation | `runtime/src/animation.ts`, `runtime/src/trackExpr.ts` | `sampleClip`, `sampleTrack`, `clipEnd`, track expressions (safe parser, no JS eval) |
| Rendering | `runtime/src/render.ts`, `runtime/src/stage.ts`, `runtime/src/editview.ts` | `drawScene`, `drawLayerList`, `hitTest`, `layerMatrix`, `createEditView` (editor canvas view) |
| Game loop | `runtime/src/game.ts`, `runtime/src/scene.ts` | `GameRuntime` (saves, settings, backlog, voice, skip), `ScenePlayer` (one scene: dialogue, choices, scripts, animation) |
| Player UI | `runtime/src/ui.ts`, `runtime/src/styles.ts`, `runtime/src/strings.ts` | Save/load, log, settings screens; runtime strings (en, zh-CN) |
| Host API | `host/src/api.ts` | All RPC methods (see §5) |
| Editor shell | `editor/src/App.tsx` | Top bar, session layout, global shortcuts, dialogs host |
| Editor state | `editor/src/state/store.ts`, `session.ts`, `prefs.ts` | Global store, one `ProjectSession` per open project, editor preferences |
| Scene editor | `editor/src/scene/*` | `SceneEditor` (tabs), `CompositionCanvas`, `LayersPanel`, `Timeline`, `ScriptView`, `sceneOps.ts` (all scene mutations) |
| Story graph | `editor/src/story/*`, `editor/src/graph/GraphCanvas.tsx` | Graph view, inspector, script import |
| Inspector fields | `editor/src/inspect/PropEditor.tsx` | Renders a `PropDef` by its `type` |
| AI assistant | `editor/src/ai/*` | `tools.ts` (MCP-style tools), `agent.ts` (loop), `ChatPanel.tsx`, `snapshot.ts` (scene picture) |
| i18n | `editor/src/i18n/en.ts`, `zh-CN.ts` | Every UI string, both languages |
| Styles | `editor/src/styles.css` | One stylesheet; CSS variables for theme |

---

## 3. Core concepts

**Project** (`project.vne.json` in a project folder, with `assets/` and `modules/`).
- `chapters[]`, plus `nodes` (a map of id → `StoryNode`) and `edges[]`.
- `characters`, `variables`, `assets`, `compositions`, `effectGraphs`, `behaviors`, `items`.
- `localization`, `settings`.

**Story graph.**
- Every node belongs to a chapter. Edges connect `{node, port}` → `{node, port}`.
- Flow ports carry execution; data ports are pulled.
- A scene node has one output per choice (`c:<choiceLayerId>`) or, without choices, `next`.
- `core.jumpOut` / `core.jumpIn` with the same number link chapters.

**Scene** (`SceneData` in `node.data`).
- `layers[]`: flat, with `parentId` for groups and optional `link` for parent links.
- `animations[]`: clips with `tracks`, `media` clips, `spans` (in/out points), markers.
- `scripts[]`: block stacks.
- `localVariables`, `transition`, `hideTextbox`, `holdSeconds`, `background`.
- Dialogue is a `core.dialogue` layer (`props.lines: DialogueLine[]`). Each choice is a `core.choice` layer (`props.text`, condition, effects).

**Layer.**
- `props` are defined by the layer type's `PropDef[]` (`visual()` adds x, y, scaleX/Y, rotation, anchorX/Y, opacity…).
- A track animates one prop: `Track { layerId, prop, keyframes, expr? }`.

**Global page.**
- The node `GLOBAL_NODE_ID` ("global") holds elements drawn on every page, such as HUD and music.
- Elements that keep running are inherited by the next page (`inherit.ts`).

**Compositions.** Reusable layer groups (`project.compositions`), optionally with their own `animation`. They are instanced by `core.composition` layers (`startAt`, `speed`, `playback`).

**Engine / registries.** `createEngine()` (runtime) registers all built-ins with owner `core`. Modules register under `<moduleId>/<localId>`. The editor builds its menus and inspectors from the registries, so a new type usually needs no editor code.

**Expressions.** There are two kinds:
- Conditions and values in nodes and choices use the AST `Expr` in `core/src/expr.ts`. Built-in functions: `random min max abs round floor length item count upper lower has`.
- Track expressions are text formulas (`follow("A", 0.2)`, `wiggle`, `loop()`…) parsed by `runtime/src/trackExpr.ts`.

---

## 4. How editing works (the one rule)

**All project changes go through `session.update(label, recipe, opts?)`**: it runs `produce` on the project, records one undo step (or merges into the previous one with the same `mergeKey` within 1.2 s), revalidates, and schedules autosave.

```ts
session.update(t('layer.move'), (d) => { /* mutate the draft d (a Project) */ }, { mergeKey: 'drag-123' });
```

- Use the helpers in `editor/src/scene/sceneOps.ts` for scene work:
  - `updateScene`, `addLayer`, `setLayerProps`, `deleteLayers`;
  - `setParent` (converts values and keyframes), `toggleKey`, `precompose`, `unlinkDeleted`.
- UI-only state (selection, open tabs, zoom, playhead) lives in `session.ui` / `session.sceneUI(nodeId)`, changed with `setUI` / `setSceneUI`. It is never saved into the project file, except `project.editor` view positions.
- Read with `session.project` (immutable); subscribe in React with `useSession(session)`.
- Labels are translated strings (they appear in the History panel, Ctrl/⌘+Shift+H).
- The AI assistant's tools call the same functions, so every AI change is undoable.

---

## 5. Host API (editor ↔ Node)

The editor calls `call('method', args)` (`editor/src/host.ts`). In Electron this is IPC; in browser mode it is `POST /api/<method>`, which only accepts `application/json` from local origins. Methods (`host/src/api.ts`):

| Group | Methods |
| --- | --- |
| Projects | `project.create`, `project.open`, `project.save`, `project.autosave`, `project.clearAutosave`, `project.trash`, `recent.list`, `recent.remove`, `examples.list`, `examples.workingCopy` |
| Files | `fs.listDir`, `fs.mkdir`, `dialog.pickFolder`, `dialog.pickFiles`, `shell.reveal` |
| Assets | `assets.import` (paths or `dataBase64`), `assets.missing`, `assets.relink` |
| Presets | `elementPresets.list/save/delete`, `effectPresets.list/save/delete/import/export` |
| AI | `ai.config`, `ai.configure`, `ai.chat`, `ai.cancel` (keys stored per service origin, encrypted with safeStorage on desktop) |
| Images | `images.config`, `images.configure`, `images.generate` (OpenAI format, Stability, Replicate) |
| Modules | `modules.list`, `modules.install`, `modules.remove`, `modules.copyToProject` |
| Export | `export.templates`, `export.run` |

Adding a method: implement it in `api.ts` (and its service file). The desktop preload forwards generically; no extra wiring needed. API keys must never be returned to the page; return `hasKey` / `keyHint` like `ai.ts` and `images.ts` do.

---

## 6. Recipes

### Add a built-in layer (element) type

Example: `core.textbox` in `runtime/src/builtins/layers.ts`.

1. Call `reg({ id: 'core.x', label: 'layer.x', icon, category, visual: true, props: visual([...]), size(l, p, rc), draw(rc, l, p) })`.
   - Optional hooks: `defaults`, `hitTest`, `createInstance` (media, DOM or interactive state), `step`.
   - Per-prop flags: `animatable`, `translatable`, `group`, `description`, `min` / `max` / `step` / `unit`.
2. Make it appear in **Add layer**: `addLayerMenu` in `editor/src/scene/CompositionCanvas.tsx` (add the item and add the id to the `shown` set). Types not listed there show automatically under their category.
3. Add an icon name to `editor/src/ui/Icon.tsx` (lucide icons via `react-icons/lu`) if it is new.
4. Add strings for `layer.x` and every new `prop.*` / option label in **both** `editor/src/i18n/en.ts` and `zh-CN.ts`.
5. If it shows text players read, mark the prop `translatable: true`. `text`-type props are translatable by default.
6. Mention it in `docs/user-guide/scenes.md`. Bump the module API minor version if modules can use something new.

### Add a property type to the inspector

Add the type to `PropType` in `core/src/registry.ts` **and** `sdk/types/index.d.ts`, then add a `case` in `editor/src/inspect/PropEditor.tsx` (example: `'composition'`).

### Add a story node type

`runtime/src/builtins/nodes.ts`: `engine.nodeTypes.register({ id, label, category, color, icon, creatable, createData(project), inputs(node, project), outputs(node, project), run?(node, ctx), evaluate?(node, port, ctx), validate?(node, project), summary?, workspace? })`. Add an editor form in `editor/src/logic/NodeForms.tsx` if it has data, validation rules in `core/src/validate.ts` if needed, and strings.

### Add a script block

`runtime/src/builtins/blocks.ts`: `{ id: 'core.x', category, shape: 'hat' | 'statement' | 'c' | 'c-else' | 'cap' | 'reporter' | 'boolean', label: 'block.x' /* template with {argId} */, args: [...], run?(ctx, args, block), report?(ctx, args, block), context?, endsScript? }`. The block editor renders it from the definition; blocks with a `layer` argument are offered under each element. Add `block.x` strings to both languages.

### Add an AI assistant tool

`editor/src/ai/tools.ts`: append `{ name, description, readOnly?, inputSchema: S.obj({...}, [required]), run: (session, input, label) => result }`.
- `run` may be async and may return `new WithImages(value, images)` to send pictures to vision models.
- Mutations must use `session.update(label('…'), …)`.
- Add `ai.tool.<name>` strings for the chat log.

### Add a UI string

Add the key to both `editor/src/i18n/en.ts` and `zh-CN.ts` (`'key': 'text'`, same order in both files), then run `node scripts/check-i18n.mjs`. It must report equal counts for `en` and `zh`. Use `t('key', { n })` with `{n}` placeholders. Runtime (in-game) strings live in `runtime/src/strings.ts`.

### Change the project format

Only when old editors would lose data:
1. Bump `PROJECT_FORMAT_VERSION`.
2. Add a migration step in `core/src/migrate.ts`.
3. Update `examples/games/like-human/project.vne.json` (`formatVersion`, `engineVersion`).
4. Add a row to `docs/modding/compatibility.md` and a note in the release notes.

### Add an editor dialog

Add the kind to the `dialog` union in `editor/src/state/store.ts`, render it in `App.tsx` (or `home/Dialogs.tsx` `DialogHost`), and open it with `store.open({ kind })`. Consider adding a command to the palette (`paletteCommands` in `home/Dialogs.tsx`).

---

## 7. Conventions (follow these)

- **CSS:** every `font-size` is `calc(Npx * var(--fs, 1))`, because of the font-size preference. Use theme variables: `--bg --bg-2 --panel --panel-2 --panel-3 --line --line-2 --text --text-2 --muted --accent --accent-soft --ok --warn --err --mono --radius-sm`.
- **Strings:** never hard-code UI text; every string exists in English and Chinese. Write UI copy plainly: say what happens, and avoid jargon.
- **Mutations:** only through `session.update` / `sceneOps`. Never mutate `session.project`.
- **IDs:** `newId('lyr' | 'chr' | 'nod' | 'cmp' | 'trk' …)`; ids are stable and referenced by translations, edges and scripts.
- **Security:**
  - no `eval` / `new Function` for user content (track expressions use their own parser);
  - host access is restricted to the open project, the module library and editor resources;
  - API keys stay in the host.
- **Exported games** load only bundled files; editor-only data (`project.editor`) is stripped.
- **Keep the runtime DOM-light:** the canvas draws layers; text boxes and menus of the *game UI* are DOM overlays (`narrative.ts`, `ui.ts`).

---

## 8. Build, test, check

```bash
npm install                 # once
node scripts/build.mjs      # or npm run build → dist/
node --test tests/*.test.mjs          # all tests (58 in 1.1.1)
npx tsc -p tsconfig.offline.json      # type check (no network type packages needed)
node scripts/check-i18n.mjs           # en/zh string parity
node scripts/gen-api-docs.mjs         # regenerate docs/api/README.md after SDK changes
node dist/server.js --port 5199       # browser editor at http://127.0.0.1:5199
```

- **Tests** import from `dist/test/vne.mjs`. Export anything new you want to test through `tests/lib.ts`, then rebuild.
- **UI checks:** drive the browser editor with Playwright, take screenshots in both languages and at a narrow window (1280×800). `globalThis.__vneStore` exposes the store for assertions.
- **Packaging:**
  - `node scripts/package-desktop.mjs --target mac-arm64 --zip` (also `mac-x64`, `win-x64`, `linux-x64`), or `npm run app:web`;
  - delete `examples/games/*/.vne/` before packaging.
- **Releases** run in GitHub Actions (`.github/workflows/release.yml`). The tag defaults to `v` + the `package.json` version.
- **Branches:** `main` has the full source; `desktop` and `web` are merged from `main` at release. When merging, keep each branch's `package.json` description and README title.
- **Versions** to bump together:
  - `package.json` `version`;
  - `ENGINE_VERSION` (and `API_VERSION` when the module API grows) in `core/src/defaults.ts`;
  - the example project's `engineVersion`;
  - `docs/release-notes/v<version>.md` in two sections, `## English` and `## 简体中文`.

---

## 9. Where to look when…

| Symptom / task | Start here |
| --- | --- |
| Canvas shows something wrong | `runtime/src/render.ts` (`drawLayerList`), the layer's `draw` in `builtins/layers.ts`, `editview.ts` |
| Dragging, handles, selection | `editor/src/scene/CompositionCanvas.tsx` (`onPointerDown`, gizmos), `sceneOps.setLayerProps` |
| Timeline UI | `editor/src/scene/Timeline.tsx`; sampling in `runtime/src/animation.ts` |
| Dialogue playback, skip, auto, voice | `runtime/src/scene.ts` (`runNarrative`), `runtime/src/game.ts` |
| Save/load/log/settings screens in games | `runtime/src/ui.ts` |
| A problem shown wrongly | `core/src/validate.ts` |
| Export output | `host/src/exporter.ts`, `host/src/templates.ts` |
| Module loading | `runtime/src/modules.ts`, `host/src/modules.ts`, `editor/src/modules/*` |
| Layout of the editor window | `editor/src/App.tsx` (`SessionView`: panels tuck away on narrow windows), `styles.css` |
| Translations | `core/src/localize.ts`, `editor/src/l10n/TranslationsDialog.tsx` |
| Script text ↔ scene | `core/src/scriptImport.ts`, `editor/src/scene/ScriptView.tsx`, `editor/src/story/ImportScript.tsx` |
