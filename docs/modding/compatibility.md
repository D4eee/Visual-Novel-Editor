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
