# Extension template

Copy this folder to start a new module.

1. Change `id` in `module.json` to a reverse-domain id you own (e.g. `io.github.alice.weather`). Never change it after release: projects store data under this id.
2. Edit `runtime.js` (game behavior) and, if you need editor UI, `editor.js`. Delete `editor` from `module.json` if you have no editor part and set `"kind": "runtime"`.
3. Put UI strings in `locales/en.json` and `locales/zh-CN.json`.
4. In the editor: **Modules → Install from file or folder…**, choose this folder. Use **Reload** in the module manager after editing files.
5. Package it: `npm run pack-module -- path/to/your-module` → `dist/modules/<id>-<version>.vnemod`.

`vendor/vne-sdk.js` gives you the `h()` and `ui` helpers for editor UIs; `vendor/vne-sdk.d.ts` gives your editor autocompletion (`// @ts-check` is on).

Full documentation: [docs/modding](../../docs/modding/README.md) · API reference: [docs/api](../../docs/api/README.md).
