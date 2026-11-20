# Interactions (visual scripting)

Interactions make scenes respond to the player. Open a scene's **Interactions** tab. Scripts are stacks of blocks: a yellow **trigger** ("When …") on top, then **actions** that run from top to bottom.

Scripts sit on a canvas: the mouse wheel zooms, dragging empty space pans, and dragging a script's trigger moves it. Drag blocks from the palette (or click one to add it to the selected script). Drop blocks inside C-shaped blocks (*if*, *repeat*). Inputs inside blocks pick layers, animations, variables, choices, sounds and so on from the project — or accept expressions.

**Elements.** The first palette category lists every element of the scene. Drag an element like a variable into any element slot of a block — for example into *Start ( )* or *Stop ( )* — or drop it on the canvas to create a *When … is clicked* script for it. Each element also has its own *when clicked* trigger next to it. New elements appear here as soon as they are added.

**Test.** **Test** plays the scene in place of the canvas while the scripts stay visible; each block lights up while it runs. **Stop** returns to editing.

Tip: with an element selected, the buttons next to **Test** create *When clicked* / *When hovered* scripts for it in one click.

## Block categories

| Category | Blocks |
| --- | --- |
| Elements | The scene's elements (drag them into slots), *Start* (show, play media and its timeline clips; optionally wait), *Stop* |
| Events | When scene starts / ends, when *layer* is clicked, hover starts / ends, key pressed, animation finished, media ended, variable changes, line shown, dialogue ends, choice selected, message received, after *n* seconds, every *n* seconds |
| Control | Wait, wait until, if, if / else, repeat, repeat until, forever, stop, broadcast message, run behavior, log |
| Looks | Show, hide, set / change property, tween property, play / stop animation, set text, set image, set portrait, shake screen, flash screen |
| Sound | Play / pause / stop media layer, play sound, play music, stop music |
| Variables | Set, change, toggle variable |
| Story | Show / hide choice, go to line, advance, show / hide text box, continue (leave the scene), go to node |

Modules can add blocks and categories. The *Extra Blocks* example adds *With N % chance*, *Show notification* and *When … reaches …*; *Relationships* adds *Change affection*.

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
