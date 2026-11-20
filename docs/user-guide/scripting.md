# Interactions (visual scripting)

Interactions make scenes respond to the player. Open a scene's **Interactions** tab. Scripts are stacks of blocks: a yellow **trigger** ("When …") on top, then **actions** that run from top to bottom.

Scripts sit on a canvas: the mouse wheel zooms, dragging empty space pans, and dragging a script's trigger moves it. Drag blocks from the palette (or click one to add it to the selected script). Drop blocks inside C-shaped blocks (*if*, *repeat*). Inputs inside blocks pick elements, animations, variables, choices, sounds and so on from the project — or accept a typed value or formula.

## Block shapes

| Shape | What it is |
| --- | --- |
| Rounded top (yellow) | **Trigger** — starts a script |
| Puzzle piece | **Action** — runs in order; C-shaped ones wrap other actions |
| Round | **Value** (reporter): a number or text, e.g. *mouse x*, *( ) + ( )*, *x of [Mika]*, a variable |
| Pointed | **Condition**: true or false, e.g. *mouse inside [area]?*, *( ) > ( )*, *key [Space] pressed?* |

Drag a value or a condition into any slot of another block — number and text slots take both, condition slots (*if*, *wait until*, *repeat until*, *and*, *or*, *not*) take conditions. Values nest: *set [score] to ((score) + (random 1 to 6))*. Drag a value out of its slot to move it to another slot, or onto the canvas or the palette to remove it (the slot gets its typed value back).

## Elements and Interactions are bound together

- **Every element has its blocks.** The **Elements** category lists the scene's elements; open one (▸, or select the element in the scene) to see the blocks for it, already filled in: its triggers (*When clicked*, *When the mouse enters*, *When media ends* …), actions (*Start*, *Stop*, *Show*, *Move to*, *Glide to*, *Set text*, *Play* …) and values (*mouse inside?*, *x of*, *visible?* …). Which blocks appear depends on the element type — media get playback blocks, text gets *Set text*, a detection area gets *mouse inside?*. Modules add blocks for their own element types the same way.
- **Elements are like variables.** Drag an element's pill into any element slot (e.g. *Start ( )*, *mouse inside ( )?*), or onto the canvas to start a *When … is clicked* script. Clicking the pill selects the element in the scene.
- **New element** creates media (from the library or a new file), shapes, text, buttons, detection areas or choices without leaving Interactions. They are added to **Layers** at once and start hidden (media don't autoplay): use *Start ( )* to show and play them when the script decides.
- Selecting an element highlights the scripts that use it. In **Layers**, an element used by scripts shows a script badge with the count — click it to jump here.
- Deleting an element that scripts use asks first; scripts started by it are removed with it and other blocks lose the reference (undo restores everything).

## Detection areas

A **detection area** (*Add element → Interactive → Detection area*) is an invisible region: a rectangle, an ellipse or a polygon. Select a polygon area to edit it on the canvas: drag a corner, double-click an edge to add a corner, double-click a corner to remove it. Use it with *When the mouse enters [area]*, *When [area] is clicked*, or as a condition: *if mouse inside [area]? then …*. Clicks and hover follow the exact shape. Turn on **Highlight on hover** to show it in the game.

**Test.** **Test** plays the scene in place of the canvas while the scripts stay visible; each block — values and conditions too — lights up while it runs. **Stop** returns to editing.

## Block categories

| Category | Blocks |
| --- | --- |
| Elements | The scene's elements with their blocks; *Start* (show, play media and its timeline clips; optionally wait), *Stop* |
| Events | When scene starts / ends, when *element* is clicked, pointer enters / leaves, when the mouse enters *element* (any element, exact shape), key pressed, animation finished, media ended, variable changes, line shown, dialogue ends, choice selected, message received, after *n* seconds, every *n* seconds |
| Control | Wait, wait until, if, if / else, repeat, repeat until, forever, stop, broadcast message, run behavior, log |
| Looks | Show, hide, move to x y, glide to x y, set size, set opacity, set / change property, tween property, play / stop animation, set text, set image, set portrait, shake screen, flash screen |
| Sound | Play / pause / stop media, play sound, play music, stop music |
| Sensing | mouse inside *element*?, *element* touching *element*?, *element* visible?, *property* of *element*, mouse x, mouse y, mouse down?, key pressed?, timer, reset timer |
| Operators | + − × ÷ mod, random *a* to *b*, > < =, and, or, not, join, letter *n* of, length of, contains?, round, abs / floor / ceiling / sqrt / sin / cos / tan / ln / log / e^ |
| Variables | Every variable as a value block; set, change, toggle variable |
| Story | Show / hide choice, go to line, advance, show / hide text box, continue (leave the scene), go to node |

Modules can add blocks and categories. The *Extra Blocks* example adds *With N % chance*, *Show notification* and *When … reaches …*; *Relationships* adds *Change affection* and the value *affection of [character]*; *Speech Bubble* gives every bubble element *[bubble] says ( ) for ( ) s* and *text of [bubble]*.

## Example: a hidden choice

The *Boot sequence* scene of the *Like Human* example:

```
When [Mika] is clicked
  Play animation [Mika waves] and wait
  Change affection of [Mika] by 1
  Play sound [sfx_beep]
  Wait 0.4 s
  Show choice [Take her hand.]
```

The choice element is marked *hidden* in its inspector, so it only appears after the click.

## Reusable behaviors

*Variables & characters → Reusable behaviors* holds scripts you can run from anywhere with *Run behavior* (for example a "Glitch" effect used in several scenes). Event nodes in the story graph run the same kind of blocks when the story passes through.

## Scene variables and messages

Scene variables reset every time the scene starts — useful for counters inside one scene. *Broadcast* sends a message that *When I receive* triggers pick up, so scripts can talk to each other.

Scripts stop automatically when the scene ends. Blocks from a module that is not installed are kept and shown as missing; they are skipped when playing.
