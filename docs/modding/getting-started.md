# Your first module

We will build **Sparkle Text**: a script block that makes a layer flash a color, plus an editor panel that remembers the default color. It touches both halves of the SDK.

## 1. Copy the template

```bash
cp -r templates/extension my-sparkle
```

Edit `my-sparkle/module.json`:

```json
{
  "id": "io.github.yourname.sparkle",
  "name": { "en": "Sparkle", "zh-CN": "闪光" },
  "version": "0.1.0",
  "engine": ">=0.2.2 <1.0.0",
  "api": "^1.1.0",
  "kind": "combined",
  "runtime": "runtime.js",
  "editor": "editor.js",
  "locales": "locales",
  "provides": { "blocks": ["flash"], "panels": ["panel"] }
}
```

The **id** is permanent: projects store your data under it, and every id you register is prefixed with it (`flash` becomes `io.github.yourname.sparkle/flash`).

## 2. The runtime part

`runtime.js` runs in the editor's preview and in exported games:

```js
// @ts-check
/// <reference path="./vendor/vne-sdk.d.ts" />

/** @param {import('./vendor/vne-sdk').RuntimeApi} api */
export function activate(api) {
  api.blocks.register({
    id: 'flash',
    category: 'looks',
    shape: 'statement',
    label: 'sparkle.flash',                    // "Flash {layer} in {color}"
    args: [{ id: 'layer', type: 'layer' }, { id: 'color', type: 'string', default: '' }],
    async run(ctx, a) {
      if (!ctx.scene) return;
      const settings = ctx.project.extensions[api.id] || {};
      const color = a.color || settings.color || '#ffe066';
      const before = ctx.scene.getProp(a.layer, 'opacity');
      ctx.scene.flash(color, 0.2);
      await ctx.scene.tween(a.layer, 'opacity', 0.3, 0.1);
      await ctx.scene.tween(a.layer, 'opacity', before ?? 1, 0.2);
    },
  });
}
```

`locales/en.json`: `{ "sparkle.flash": "Flash {layer} in {color}", "sparkle.panel": "Sparkle", "sparkle.color": "Default color" }` — and the same keys in `locales/zh-CN.json`.

Block labels are templates: `{layer}` is replaced by the input for the argument `layer`. The editor shows a layer picker because the argument type is `layer`.

## 3. The editor part

`editor.js` runs only in the editor:

```js
// @ts-check
import { h, ui } from './vendor/vne-sdk.js';

/** @param {import('./vendor/vne-sdk').EditorApi} api */
export function activateEditor(api) {
  api.panels.register({
    id: 'panel', title: 'sparkle.panel', icon: 'sparkles', location: 'sidebar',
    mount(el, ctx) {
      const render = () => {
        const data = ctx.project().extensions[api.id] || {};
        el.replaceChildren(
          ui.field(ctx.t('sparkle.color'), ui.color(data.color || '#ffe066', (v) =>
            ctx.update(ctx.t('sparkle.color'), (d) => { d.extensions[api.id] = { ...data, color: v }; }))),
        );
      };
      render();
      return ctx.onChange(render);   // re-render on undo/redo; returned function cleans up
    },
  });
}
```

`ctx.update` is an undoable change of the project. Data under `project.extensions[api.id]` is saved with the project and exported with the game.

## 4. Install and try it

1. Open a project, open the **module manager**, choose **Install from file or folder…** and select `my-sparkle/module.json`.
2. The module is copied into the project's `modules/` folder and switched on. A **Sparkle** panel appears in the left rail.
3. Open a scene → **Interactions**. The *Flash … in …* block is in the Looks category.
4. Preview the scene. Errors from your module appear in the preview's **Errors** tab and in the module manager.

After editing your files, copy them again (or install again) and press **Reload modules** in the module manager.

## 5. Package

```bash
npm run pack-module -- my-sparkle
# → dist/modules/io.github.yourname.sparkle-0.1.0.vnemod
```

The packer checks the manifest, entry files and locale JSON before writing the package. Share the `.vnemod`; others install it with **Install from file or folder…** — no network needed.

## Next

- Everything you can register at runtime: [runtime.md](runtime.md)
- Editor UI: [editor.md](editor.md)
- Keeping projects safe across versions: [compatibility.md](compatibility.md)
