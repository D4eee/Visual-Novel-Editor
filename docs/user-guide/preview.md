# Preview and debugging

**Preview** runs the story with the same runtime that exported games use — what you see is what players get.

## Where to start

The menu next to **Preview** chooses the scope:

- **Current scene** (default) – the scene you are editing or have selected
- **Start of this chapter** – the chapter's entry
- **Start of the game** – the Start node, with the title screen

Right-click a node (or use the button in its inspector) → **Preview from here**.

While the preview runs, the **Preview** button turns into a red **Stop** button: click it (or press **Ctrl/⌘+P**) to stop the preview and return to editing.

## The debug panel

| Tab | Shows |
| --- | --- |
| **State** | The active node and every variable. Edit values while playing to test branches |
| **Path** | Nodes visited so far; click one to reveal it in the graph |
| **Events** | Runtime events as they happen: clicks, lines, choices, animations, variable changes, module logs |
| **Errors** | Script, effect and module errors with their source |

**Restart** starts again from the chosen scope. The preview keeps running while you edit; changes apply when you restart.

Keyboard in the game: **Space / Enter / click** advance, **Ctrl** skips while held, **Esc** opens the menu, **1–9** pick choices.
