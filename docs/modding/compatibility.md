# Data, compatibility and safety

Creators trust modules with their stories. These rules keep projects safe when modules change, disappear or misbehave.

## Ids are forever

- Your module id and every local id you register (`nodes`, `layers`, `blocks`, ports, properties…) are written into projects. Never rename them; register a new id and keep the old one working instead.
- Port ids of nodes are stored in connections. Keep them stable even if labels change. Derive dynamic ports from stable data ids (as scenes do with `c:<choiceId>`).
- Data you store (`node.data`, layer `props`, component `data`, `project.extensions[id]`) is plain JSON. Add fields with defaults; do not repurpose old ones. Read defensively: `node.data.threshold ?? 6`.

## Missing modules preserve data

When a project references a module that is not installed, disabled, incompatible or failed to load:

- its nodes, layers, blocks, effect nodes and components stay in the project exactly as they were and are saved unchanged;
- the editor shows them as *not installed* (with the module's id) instead of hiding them;
- the Problems list reports every use, and export is blocked if the game would need the module's runtime;
- installing the module restores everything.

Unknown top-level fields in `project.vne.json` are preserved too, so projects survive round trips through older editors.

## Engine and API versions

Declare `engine` (e.g. `">=0.1.0 <1.0.0"`) and `api` (e.g. `"^1.0.0"`). A module outside its range is not loaded, and the module manager explains why. The current versions are shown in the module manager and in `api.engineVersion` / `api.apiVersion`.

## Error isolation

- Every function you register is wrapped: an exception is caught, reported with your module id (module manager, the node's Modules tab, the preview's **Errors** tab), and the engine continues — a broken block is skipped, a broken layer is not drawn, a broken node stops that branch with a message.
- After repeated errors (50) a module is switched off for the session so it cannot flood the game.
- If `activate()` throws, everything the module had registered is rolled back and the module is marked *failed*.
- Mount functions for editor UI are isolated the same way.

Isolation protects against mistakes, not malice: modules run with the editor's privileges. Users should install modules only from sources they trust, and modules should not access the network or the file system unless that is their documented purpose.

## Exported games

Only the runtime entry (`runtime`), locales and declared assets are copied into exported games. Editor entries never are. Keep the runtime part self-contained: no imports from the editor, no Node APIs.

## Performance

- `draw()`, `evaluate()` and `frame()` run every frame: allocate nothing per frame, reuse canvases from `ctx.pool`, cache measurements.
- Prefer reading `project` once in `create()`/`sceneEnter()` over scanning it every frame.

## API history

| API | Engine | Added |
| --- | --- | --- |
| 1.5.0 | 1.1.1 | The `composition` property type (a picker of the project's compositions), the built-in `core.textbox` element, `History.steps()` / `History.go(n)` |
| 1.4.0 | 1.1.0 | `PropDef.translatable` and `BlockArgDef.translatable` (texts players read go into the translation table), `Project.localization` (translations; games play the localized copy, so modules read translated texts with no extra work), `Composition.animation` (compositions play their own animation; composition elements have `startAt`, `speed`, `playback`), `Track.expr` (track expressions). Project format 5 |
| 1.3.0 | 1.0.0 | `BlockDef.endsScript` (C blocks that end a script, drawn without a bottom connector), `Layer.link` (parent & link — `linkMatrix`, `parentSpace` in the runtime), animation in/out points (`AnimationClip.spans`; layers outside their span read `__span: false` and are not drawn), `AnimationClip.markers` / `workArea` (editor only). Project format 4 |
| 1.2.0 | 0.3.0 | Game module: `Layer.params` and `Layer.zone`, list variables (`VarValue` arrays), `Project.items` / `inventoryVarId`, `runtime.items`, block arg types `item` and `param`, `BlockArgDef.varType` / `paramOf` / `optional`, category `game`, `LayerTypeDef.step` / `pointer` / `interactive`, prop type `item`, scene `layers`, `layerOrigin`, `reorder`, `pauseElement` / `resumeElement`, `showLabel` / `hideLabel`, `pickUp`. The global page (node type `core.global`) and page-to-page inheritance. Project format 3 |
| 1.1.0 | 0.2.2 | Reporter and condition blocks (`shape: 'reporter' | 'boolean'`, `report()`), per-element blocks (`BlockDef.layerTypes`, `BlockArgDef.layerTypes`), `LayerTypeDef.hitTest`, scene sensing (`contains`, `touching`, `isVisible`, `bounds`, `timer`), `runtime.input` |
| 1.0.0 | 0.1.0 | First public API |

Additions are backwards compatible: modules written for `^1.0.0` keep working. A module that uses 1.1–1.5 features should declare the matching `"api"` range (`"^1.1.0"` … `"^1.5.0"`) so older editors refuse it with a clear message instead of failing.
