# Example extensions

Each folder is a complete, installable module. Together they cover every extension point required by the SDK:

| Folder | Demonstrates |
| --- | --- |
| [dice-check](dice-check) | Custom story nodes, a custom port type, data connections |
| [speech-bubble](speech-bubble) | A custom layer type |
| [wobble](wobble) | Custom animated properties and an interpolation curve |
| [retro-fx](retro-fx) | Custom effect nodes (Canvas 2D and GLSL) and a transition |
| [extra-blocks](extra-blocks) | Custom visual scripting blocks and an expression function |
| [timed-choices](timed-choices) | A node module with a custom editor interface and runtime behavior |
| [relationships](relationships) | A gameplay module with an editor panel, system, blocks, node, scene module and save data |

Modules are plain ES modules – no build step is required. `vendor/vne-sdk.js` is a copy of `sdk/dist/index.js` (refreshed by `npm run build`) used by editor entry points for the `h()` and `ui` helpers.

Start your own from [templates/extension](../../templates/extension).
