# Dice Check

Example extension for Visual Novel Editor demonstrating **custom story nodes, a custom port type, data connections**.

- **Roll Dice** (`rollDice`) – a *data* node. It has no flow ports; its `roll` output is a value of the custom port type `roll`. It is evaluated lazily when a connected node asks for it (`evaluate(node, port, ctx)`).
- **Skill Check** (`skillCheck`) – a flow node with **Success** and **Failure** outputs. It reads its optional `bonus` data input (shown as *Roll*) with `await ctx.input('bonus')`, compares against a difficulty and returns the output port id to follow.
- `validate()` reports problems in the editor's Problems list.

Try it: add a Skill Check node between two scenes in the Story Flow, connect a Roll Dice node to its *Roll (optional)* input, then preview the chapter. The debug panel's log shows each roll.

## Files

- `module.json` – the manifest (id, version, compatibility, entry points).
- runtime.js – `api.ports.register`, `api.nodes.register` with `inputs/outputs/run/evaluate/validate/summary/props`.
- `locales/en.json`, `locales/zh-CN.json` – UI strings. Labels in definitions are i18n keys looked up in these files.

## Install

In the editor: **Modules → Install from file or folder…** and pick this folder (or install the packaged `.vnemod` built with `npm run pack-module -- examples/extensions/dice-check`). It is copied into the project's `modules/` folder and switched on for the project, so it travels with the project.

See [docs/modding](../../../docs/modding/README.md) for the full guide.
