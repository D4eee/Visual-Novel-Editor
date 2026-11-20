# Runtime extensions

`runtime.js` exports `activate(api)`. It runs whenever a project that uses the module is opened in the editor (for the canvas, the preview and validation) and inside exported games. Everything below is registered on `api`; ids are namespaced automatically (`'bubble'` → `'com.example.speech-bubble/bubble'`). Labels and descriptions are i18n keys from your `locales/` (plain text works too).

Each `register()` returns an unregister function. You never need to clean up: when a module is switched off, everything it registered is removed.

## Property schemas (`PropDef`)

Story nodes, layers, properties and node modules describe their settings with `PropDef`s; the editor builds the inspector from them:

```js
{ key: 'speed', type: 'number', label: 'my.speed', default: 1, min: 0, max: 5, step: 0.1, unit: 's', animatable: true, group: 'motion', description: 'my.speed.desc' }
```

Types: `number string text boolean color select asset character portrait variable layer animation choice node font json`. `select` takes `options: [{ value, label }]`; `asset` takes `assetKind`. `animatable: true` adds ◆ keyframe controls (numbers and colors interpolate; other types hold). `hidden: true` keeps a value out of the generated form.

## Story nodes and ports — `api.nodes`, `api.ports`

```js
api.ports.register({ id: 'roll', label: 'dice.roll', color: '#f6c445', kind: 'data', accepts: ['number'] });

api.nodes.register({
  id: 'skillCheck', label: 'dice.check', category: 'module', color: '#f6c445', icon: 'dice',
  createData: () => ({ difficulty: 10 }),
  inputs: () => [{ id: 'in', type: 'flow', multiple: true }, { id: 'bonus', label: 'dice.bonus', type: `${api.id}/roll` }],
  outputs: () => [{ id: 'success', label: 'dice.success', type: 'flow' }, { id: 'failure', label: 'dice.failure', type: 'flow' }],
  props: [{ key: 'difficulty', type: 'number', label: 'dice.difficulty', min: 1 }],
  summary: (node) => `DC ${node.data.difficulty}`,
  async run(node, ctx) {
    const bonus = Number(await ctx.input('bonus')) || 0;
    return Math.random() * 20 + bonus >= node.data.difficulty ? 'success' : 'failure';
  },
  validate: (node) => node.data.difficulty > 0 ? [] : [{ severity: 'error', code: 'dice.dc', message: 'dice.issue.dc' }],
});
```

- **Flow ports** (`type: 'flow'`) carry the story. `run()` returns the output port to follow, `null` to stop, `{ goto: nodeId }` or `{ end: true }`.
- **Data ports** carry values and are pulled lazily: `ctx.input(port)` calls `evaluate(node, port, ctx)` on the connected node. A node with only data outputs (like *Roll Dice*) needs no flow input and is never "unreachable".
- Built-in port types: `flow`, and the data types `number`, `string`, `boolean`, `any`. Your type can `accept` others.
- Outputs may depend on the node's data (`outputs(node)` is called on every change) — that is how scenes have one port per choice. Keep port ids stable.
- `workspace: 'logic'` gives the node the generic node workspace (form from `props` and a **Modules** tab).

## Layers — `api.layers`

```js
api.layers.register({
  id: 'bubble', label: 'bubble.layer', icon: 'message', category: 'text', visual: true,
  props: [{ key: 'text', type: 'text', label: 'bubble.text', default: 'Hi!' }, { key: 'width', type: 'number', label: 'bubble.width', default: 300, animatable: true }],
  size: (layer, p, rc) => ({ width: p.width, height: 120 }),   // rc.measure is a 2D context for text metrics
  draw(rc, layer, p) { rc.ctx.fillStyle = '#fff'; rc.ctx.fillRect(0, 0, p.width, 120); },
});
```

- `visual: true` layers get transform properties automatically (position, scale, rotation, anchor, opacity) plus selection handles, hit-testing, effects and animation.
- `draw()` paints in the layer's local space (0,0 = top-left, size from `size()`); `rc.time` is the scene clock, `rc.mode` is `'edit'` or `'play'`, `rc.assets.image(id)` returns a loaded image.
- `createInstance(layer, rt)` gives a layer per-scene state (media elements, particle systems). Instances get `update(dt, props, time)`, `draw(rc, props)`, `play()`, `pause()`, `stop()`, `dispose()`.
- `defaults({ project, width, height })` sets initial values when the layer is created.

## Animated properties — `api.properties`

Add a property to existing layer types:

```js
api.properties.register({
  id: 'float', layerTypes: '*',
  prop: { key: 'float', type: 'number', label: 'float.prop', default: 0, unit: 'px', animatable: true },
  phase: 'transform',
  apply(rc, layer, props, value) { rc.ctx.translate(0, Math.sin(rc.time * 1.6) * value); },
});
```

The property shows up in the inspector (with ◆), on the timeline, in *Set/Tween property* blocks and as an effect-graph drive target. `phase`: `'transform'` and `'before'` run before the content is drawn, `'after'` (default) after it. `rc.width`/`rc.height` give the layer size.

## Interpolation curves — `api.interpolators`

```js
api.interpolators.register({ id: 'smoothstep', label: 'wobble.ease', ease: (t) => t * t * (3 - 2 * t) });
```

Appears in the keyframe interpolation menu and in *Tween* blocks. `discrete: true` holds values.

## Effect nodes — `api.effects`

```js
api.effects.register({
  id: 'scanlines', label: 'retro.scanlines', category: 'filter', animated: true,
  inputs: [{ id: 'image', label: 'retro.image', type: 'image' }, { id: 'spacing', label: 'retro.spacing', type: 'number', default: 4, min: 2 }],
  outputs: [{ id: 'image', label: 'retro.result', type: 'image' }],
  evaluate(ctx, i) {
    if (!i.image) return { image: null };
    const out = ctx.pool.acquire(i.image.width, i.image.height);
    const g = out.getContext('2d');
    g.drawImage(i.image, 0, 0);
    /* … */
    return { image: out };
  },
});
```

- Image values are canvases. Always get scratch canvases from `ctx.pool` (they are recycled every frame) and return new ones rather than drawing into inputs.
- `ctx.shaders.run(ctx.pool, glsl, image, uniforms, ctx.time)` runs a GLSL ES 1.0 fragment shader (`u_image`, `u_size`, `u_time`, `uv`).
- `animated: true` declares that the output changes over time, so the editor keeps redrawing layers that use the node.
- `ctx.drive(layerId, prop, value)` (drive nodes) sets a layer property for this frame.

## Transitions — `api.transitions`

```js
api.transitions.register({
  id: 'pixels', label: 'retro.transition', params: [{ key: 'block', type: 'number', label: 'retro.block', default: 24 }],
  draw(ctx, from, to, progress, params) { /* compose `from` and `to` into ctx for 0 ≤ progress ≤ 1 */ },
});
```

## Script blocks — `api.blocks`

```js
api.blocks.register({
  id: 'chance', category: 'control', shape: 'c', label: 'xb.chance', color: '#c46ff0',
  args: [{ id: 'percent', type: 'number', default: 50 }],
  async run(ctx, a, block) { if (Math.random() * 100 < a.percent) await ctx.runBody(block.body); },
});
```

- Shapes: `hat` (trigger), `statement`, `c` (has a body), `c-else`, `cap` (ends a script).
- Argument types give the editor its pickers: `number string boolean layer animation variable asset choice line key select expr port node character portrait behavior prop ease message`. Arguments are evaluated (expressions resolved) before `run()`.
- `ctx` (ScriptContext): `scene` (SceneApi), `vars`, `runtime` (GameApi), `wait(s)`, `waitUntil(fn)`, `runBody(blocks)`, `emit(event)`, `evaluate(v)`, `stop()`. Waits are cancelled automatically when the scene ends.
- **Hats**: set `event` (a runtime event type) and `matches(event, args)`; or `setup(ctx, args, fire)` for custom triggers (timers, DOM listeners) returning a cleanup function.
- `context: 'story'` makes a block available in Event nodes (story actions); `'both'` everywhere.

Runtime events you can listen to include `scene.enter`, `scene.exit`, `layer.click`, `layer.hoverEnter`, `layer.hoverLeave`, `key.down`, `anim.finished`, `media.ended`, `var.changed`, `dialogue.line`, `dialogue.end`, `choice.selected` and `message`, plus anything modules dispatch.

## Node modules (components) — `api.components`

A component is module data attached to a specific node, edited in that node's **Modules** tab:

```js
api.components.register({
  id: 'timer', label: 'tc.label', nodeTypes: ['core.scene'],
  props: [{ key: 'seconds', type: 'number', label: 'tc.seconds', default: 8 }],
  sceneEnter(ctx, data, state) { state.off = ctx.on('dialogue.end', () => { /* … */ }); },
  frame(ctx, data, dt, state) { /* every frame while the scene runs */ },
  sceneExit(ctx, data, state) { state.off?.(); },
  validate(data, node) { return []; },
});
```

`state` is a private object per scene run. `ctx.scene` controls the scene (`availableChoices()`, `pickChoice(id)`, `setProp()`…); `ctx.runtime.hud` is a DOM layer for HUD elements. On non-scene nodes use `nodeRun()`; returning a port id overrides routing. `multiple: true` allows several instances per node. Pair a component with an editor `nodeWorkspaces` entry for a custom UI (see `timed-choices`).

## Systems — `api.systems`

A system lives for a whole playthrough:

```js
api.systems.register({
  id: 'affection', label: 'rel.system',
  create(game) {
    let values = {};
    return {
      change(id, d) { values[id] = (values[id] || 0) + d; game.events.emit('affection.changed', { id, value: values[id] }); },
      save: () => ({ values }),            // stored in save slots
      load: (data) => { values = data?.values || {}; },
      dispose() {},
    };
  },
});
```

Other code reaches it with `runtime.system('<module id>/affection')`. `save()`/`load()` make it part of save games. `game` (GameApi) gives `project`, `vars`, `audio`, `events`, `hud`, `scene`, `gotoNode()`, `toast()`, `debugLog()` and more.

## Expression functions — `api.functions`

```js
api.functions.register({ id: 'affection', label: 'affection', args: 1, fn: (name) => current?.byName(name) ?? 0 });
```

Functions are called by their **local** name in conditions and expressions: `affection("Mika") >= 5`. Built-in names (`random`, `min`, `max`…) cannot be overridden.

## Other API members

- `api.i18n.t(key, params)`, `api.i18n.locale`
- `api.assetUrl('assets/icon.png')` — a URL to a file in your module folder that works in the editor and in exported games
- `api.log.info/warn/error(...)` — shown in the preview's Events/Errors tabs
- `api.storage` — namespaced persistent storage, only with the `"storage"` permission
- `api.mode` — `'editor'`, `'preview'` or `'game'`
