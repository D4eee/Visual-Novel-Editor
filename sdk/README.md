# SDK

The module SDK of Visual Novel Editor.

- `types/index.d.ts` — the complete, documented module API (runtime and editor). Reference it from your module with `/// <reference path="…/index.d.ts" />` and `// @ts-check` for autocompletion. The [API reference](../docs/api/README.md) is generated from it.
- `src/index.ts` → `dist/index.js` (built by `npm run build`) — small helpers for editor UIs: `h()` (DOM builder), `ui.*` (controls styled like the editor), `defineRuntime()` / `defineEditor()` (typed wrappers). Modules usually ship a copy as `vendor/vne-sdk.js`.

Start with the [modding guide](../docs/modding/README.md) and the [extension template](../templates/extension).
