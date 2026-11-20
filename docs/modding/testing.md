# Testing and debugging

## While developing

1. Install your module folder into a test project (**Install from file or folder…** → choose `module.json`).
2. After editing files, install again (or copy the files into `<project>/modules/<id>/`) and press **Reload modules** in the module manager.
3. Use `// @ts-check` and the typings (`vendor/vne-sdk.d.ts` in the template, or `sdk/types/index.d.ts`) for autocompletion and type errors in your editor.

## Where errors show up

| Place | What |
| --- | --- |
| Module manager | Load errors, incompatibilities, missing dependencies, the last runtime errors of each module |
| Preview → **Errors** | Errors raised while playing, with module id and node |
| Preview → **Events** | Runtime events and `api.log` / `runtime.debugLog()` output |
| Problems list | `validate()` results of your nodes and components, missing types |
| Developer tools | **View → Developer Tools** (desktop) shows full stack traces |

## Automated tests

The runtime part of a module runs in Node for logic tests. The repository's own tests load every example module with the engine's `ModuleHost` (see `tests/modules.test.mjs`):

```js
import { createEngine, ModuleHost, I18n } from '../dist/test/vne.mjs';
const engine = createEngine();
const host = new ModuleHost(engine, new I18n('en'), { mode: 'game', onError: console.error });
await host.loadAll([{ manifest, baseUrl: pathToFileURL(dir + '/').href }]);
assert.equal(host.records.get(manifest.id).status, 'active');
assert.ok(engine.nodeTypes.get(`${manifest.id}/skillCheck`));
```

Run `npm test` in the repository to build the test bundle and run all tests.

## Checklist before publishing

- `npm run pack-module -- <folder>` succeeds (manifest, entries and locales are valid).
- English and Chinese (or your languages) locale files have the same keys.
- The module works in the preview **and** in an exported web build (`Export → Web`, then serve the folder).
- A project that uses the module still opens, with data intact, after the module is removed.
- `validate()` explains configuration mistakes in words a writer understands.
