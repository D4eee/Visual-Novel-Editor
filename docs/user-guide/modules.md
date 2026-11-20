# Modules

Modules extend the editor and the games it makes: new story nodes, layer types, animatable properties, effect nodes, transitions, script blocks, gameplay systems, node settings, editor panels, importers and exporters.

## Installing

Open the **module manager** from the top bar.

- **Install from file or folder…** accepts a `.vnemod` package, a `.zip`, or a folder (choose its `module.json`). The module is copied into the project's `modules/` folder and switched on, so the project carries everything it needs.
- The **Library** list also shows modules installed for all projects and the bundled example modules; **Use in this project** switches one on.
- Each module shows its version, what it provides, compatibility with this editor version, dependencies, and its status. Problems (incompatible version, missing dependency, an error while loading) are explained in the module's details and in the Problems list.

Modules can be switched off or removed. Their settings and the data they stored in nodes and layers stay in the project, so switching a module back on restores everything.

## Using modules

What a module adds appears where its built-in counterparts are: node types in the graph's *Add node* menu, layers under *Add layer*, properties in the inspector, effect nodes in the effect graph, transitions in the scene inspector, blocks in the palette, and panels in the left rail.

**Node modules.** Scenes and other nodes have a **Modules** tab. **Add module…** attaches a module component to that node — for example *Timed choices* (a countdown on the scene's choices) or *Affection on enter*. Some show a custom interface there.

## Missing modules

When a project uses a module that is not installed (for example, you received the project from someone else), the editor keeps all of its data untouched: nodes, layers and blocks from the module are shown as *not installed* and listed in the Problems list. Install the module and everything comes back. Exporting is blocked while required runtime modules are missing.

## Modules and export

Exported games include the **runtime** part of every module the project uses — never editor-only code. The export dialog lists them.

## Safety

Modules are JavaScript and run with the same rights as the editor. Only install modules from people you trust. A module that throws errors is stopped and reported without taking down the editor or the game.

To write your own, see the [modding guide](../modding/README.md).
