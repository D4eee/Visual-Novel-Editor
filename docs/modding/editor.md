# Editor extensions

`editor.js` exports `activateEditor(api)`. It runs only inside the editor and is **never** copied into exported games, so it can be as heavy as you like.

UI is mounted with plain DOM: every extension point receives `mount(el, ctx)`. Build any UI into `el` (vanilla DOM, the SDK's `h()`/`ui` helpers, or a framework you bundle yourself) and return a cleanup function. The editor's CSS variables and classes (`muted`, `small`, `char-card`, `issue warning`…) are available, and the SDK `ui.*` controls already match the editor's look.

## The mount context

| Member | Purpose |
| --- | --- |
| `ctx.project()` | The current project (read-only snapshot) |
| `ctx.update(label, draft => …)` | An undoable change; mutate the draft freely. `label` appears in undo messages |
| `ctx.onChange(fn)` | Called after every change, undo and redo; returns an unsubscribe function |
| `ctx.t(key, params)` / `ctx.locale()` | Your locale strings and the interface language |
| `ctx.toast(text, kind)` | A short notification |
| `ctx.openNode(id)` | Open a node in the editor |
| `ctx.nodeId`, `ctx.instanceId`, `ctx.data`, `ctx.setData(patch, label)` | Node workspaces: the node, the component instance and its data |
| `ctx.layerId`, `ctx.data`, `ctx.setLayerProps(patch, label)` | Layer inspectors: the layer, its properties, and an undoable, keyframe-aware setter |

Always re-render from `ctx.project()` in `onChange`, so undo/redo and other windows stay in sync.

## Extension points

| `api.…` | Appears | Typical use |
| --- | --- | --- |
| `panels` (`location: 'sidebar'`) | A button in the left rail, with a panel | Settings for a gameplay system, project-wide tools |
| `panels` (`location: 'bottom'`) | A tab in the scene dock | Scene-level tools |
| `inspectors` (`target: layerTypeId`) | A section in the inspector of that layer type | Presets, helpers, previews |
| `nodeWorkspaces` (`component: componentId`) | Replaces the generated form of your component in a node's **Modules** tab | Rich editors that need the node's context |
| `workspaces` | A full editor tab, opened from the top bar's module workspaces menu | Large tools: maps, databases, dialogue trees |
| `toolbar` | A button in the top bar; `run(ctx)` | One-shot actions |
| `importers` (`extensions: ['.csv']`) | Dropping such files on the Assets panel calls your importer instead of importing them as assets | Import scripts, translations, spreadsheets |
| `exporters` | **Export → Other exports** | Reports, translation files, recording scripts |

All of them are registered like runtime definitions (`register()` returns an unregister function) and are removed when the module is switched off.

## Project data

Store module settings in `project.extensions[api.id]` (helpers: `api.project.getData()` / `api.project.setData(value, label)`). That object is saved with the project, part of undo/redo, and exported with the game — so the runtime part can read it from `runtime.project.extensions[api.id]`.

Store per-node settings as component instances (`api.components` + `nodeWorkspaces`), per-layer settings as layer properties (`api.properties`), never in your own files.

## Example: a node workspace

From `examples/extensions/timed-choices/editor.js`:

```js
api.nodeWorkspaces.register({
  id: 'timerUi',
  component: `${api.id}/timer`,
  mount(el, ctx) {
    const render = () => {
      const node = ctx.project().nodes[ctx.nodeId];
      const inst = node.modules.find((m) => m.id === ctx.instanceId);
      const choices = node.data.choices || [];
      el.replaceChildren(
        ui.field(ctx.t('tc.seconds'), ui.slider(inst.data.seconds, (v) => ctx.setData({ seconds: v }), { min: 1, max: 30, step: 0.5 })),
        ui.field(ctx.t('tc.default'), ui.select(inst.data.defaultChoice || '', choices.map((c) => ({ value: c.id, label: c.text })), (v) => ctx.setData({ defaultChoice: v }))),
      );
    };
    render();
    return ctx.onChange(render);
  },
});
```

## Errors

Exceptions thrown by mount functions and callbacks are caught, shown in place of your UI with a short message, and listed in the module manager. They never break the editor.
