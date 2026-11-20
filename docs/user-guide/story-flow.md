# The story flow graph

The story is a graph of **nodes** connected by **edges**, organised in **chapters**. Each chapter has its own graph; *All chapters* shows the whole story at once.

## Working with the graph

| Action | How |
| --- | --- |
| Add a node | Double-click empty space, press **Tab**, or drag from a port into empty space (the new node is connected) |
| Connect | Drag from an output port (right side) to an input port (left side). Incompatible ports refuse the connection and say why |
| Reconnect / disconnect | Drag an existing connection off its input port; drop it on empty space to remove it |
| Select | Click; **Shift+drag** for a box; **Ctrl/⌘+A** for all |
| Move | Drag nodes. Drag nodes onto a chapter in the outline to move them to that chapter |
| Copy, paste, duplicate | **Ctrl/⌘+C**, **Ctrl/⌘+V**, **Ctrl/⌘+D** (connections between copied nodes are kept; ids are new) |
| Open a node | Double-click or **Enter** |
| Frame | **F** frames everything (or the selection) |
| Pan / zoom | Drag empty space or **Space+drag**; mouse wheel / pinch |
| Find | **Ctrl/⌘+K** searches scenes, lines, choices, chapters and assets |

## Node types

| Node | Ports | What it does |
| --- | --- | --- |
| **Start** | one output | Where the game begins. One per project |
| **Scene / Page** | input; *Next* or one output per choice | A playable page with layers, dialogue, choices, animation and scripts |
| **Event** | input, output | Runs actions (blocks) as the story passes: set variables, play sounds, run behaviors… |
| **Condition** | input; *True*, *False* | Evaluates an expression on variables |
| **Random** | input; one weighted output per branch | Picks a branch at random |
| **Wait** | input, output | Pauses while the current scene stays on screen |
| **Jump In** | input | Continues at the **Jump Out** with the same number — in any chapter |
| **Jump Out** | output | Destination of Jump In nodes with its number |
| **Ending** | input | Shows an ending card, can unlock a persistent variable, then returns to the title, restarts or quits |
| **Note** | none | A sticky note for planning; never runs |

Modules can add more node types (for example the *Affection Branch* from the Relationships example). Nodes from a module that is not installed stay in the project unchanged and are marked as missing.

## Choices and their outputs

A scene with choices has one output per choice (choices are **Choice** elements on the scene canvas; outputs are ordered top to bottom and labelled C1, C2 …; hover an output for a second to see the choice). Adding a choice adds its output immediately — the first choice takes over the *Next* connection. Each choice has a permanent id, so reordering or renaming choices never breaks connections, and deleting a choice removes only its own connection. Choices can be:

- **conditional** – shown only when an expression is true, or shown disabled (the *When unavailable* setting);
- **hidden** – revealed later by a script (*Show choice* block);
- **with effects** – change variables when chosen;
- **animated** – play an animation when chosen.

## Conditions and expressions

Expressions are built with the expression editor: variables, numbers, text, comparisons (`= ≠ < ≤ > ≥`), `and / or / not`, arithmetic and functions such as `random(1, 6)`, `min`, `max`, `round`, `length`. Modules can add functions — the Relationships example adds `affection("Mika")`.

## Jumps and chapters

Jump In / Jump Out pairs share a number. Use them to:

- keep a big chapter readable (jump instead of drawing a long wire);
- go to another chapter (the Jump In lives in chapter 1, the Jump Out in chapter 2);
- merge several routes (many Jump Ins → one Jump Out).

Each chapter has an **entry**: its Start node, a chosen node, or automatically the first Jump Out. *Preview from chapter start* begins there.

## Validation

The Problems list (status bar) is updated as you edit. It reports, among others: outputs that lead nowhere, unreachable nodes, Jump In without a matching Jump Out, empty conditions, missing assets, references to deleted variables, layers or choices, and nodes or blocks from missing modules. Errors block export; warnings do not.

## Copy, paste and peek

- **Copy and paste nodes** with **Ctrl/⌘+C** and **Ctrl/⌘+V** (also *Edit → Copy / Paste* in the desktop app, and **Ctrl/⌘+X** to cut). Pasted nodes land under the pointer and are complete copies — a scene keeps its elements, lines, choices, animations and scripts, with new ids; connections between the copied nodes are copied too. The clipboard works across chapters, projects and windows. **Ctrl/⌘+D** duplicates the selection in place.
- **Peek at a scene**: rest the pointer on a node for a second to see its first line of dialogue (speaker and text — choice text is not shown). Other nodes show their text, if they have any.
