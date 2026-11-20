# Scenes and layers

Open a scene node to get its **Composition** workspace: the canvas in the middle, the **Layers** list on the left, the inspector on the right and the dock below. The **Modules** tab next to *Composition* holds module settings attached to this scene.

## Layers

**Add layer** (or drag an asset onto the canvas) creates layers:

| Layer | Use |
| --- | --- |
| Background | Fills the screen (cover / contain / stretch) with an image or a color |
| Image | Any picture |
| Character | A character with switchable portraits (expressions); follows the portrait chosen on each dialogue line |
| Text | Rich text with a typing reveal (animatable) |
| Shape | Rectangles, ellipses, lines; fills, gradients, strokes, rounded corners |
| Button | A clickable button with text and styles |
| Hotspot | An invisible clickable area |
| Video | A video clip; plays in sync with the timeline when added as a clip |
| Audio | Music, ambience, sound effects or voice; music can continue into following scenes |
| Group | Holds other layers; transforms apply to its children |
| Composition | An instance of a reusable composition (see below) |
| Particles | Snow, rain, dust, sparkles, petals |
| Module layers | Added by modules, e.g. *Speech bubble* from the example modules |

On the canvas: drag to move, corner handles to scale, the round handle to rotate. **Shift** keeps proportions while scaling, locks movement to one axis and rotates in 15° steps; **Alt** temporarily disables snapping; arrow keys nudge (Shift ×10). Snapping to edges and centers can be switched off below the canvas. **Ctrl/⌘+G** groups layers. Lock and hide layers in the Layers list; drag to reorder or re-parent.

The inspector shows every property of the selected layer. Properties with a ◆ button can be animated (see [Animation](animation.md)).

## Dialogue and choices

The **Dialogue & choices** dock lists the scene's lines in order.

- **Enter** creates the next line, **Shift+Enter** a line break, **Tab** cycles the speaker.
- Each line has a speaker (a character, a custom name, or narration) and optionally a portrait. Characters on stage switch to that portrait.
- Text supports `{variable name}` (replaced by its value) and markup: `[b]bold[/b]`, `[i]italic[/i]`, `[u]underline[/u]`, `[color=#ff6f9f]…[/color]`, `[size=1.4]…[/size]`, `[wave]…[/wave]`, `[shake]…[/shake]`, `[speed=2]…[/speed]` and `[wait=0.5]` (pause the typewriter).
- Lines can have a voice clip and per-line settings.

Choices appear after the last line. See [Story flow](story-flow.md#choices-and-their-outputs).

## Scene settings

Select empty canvas space to see the scene inspector: name, page number, background color, entrance transition, whether the text box is hidden, how long to stay on screen without dialogue, and **scene variables** (temporary values that reset each time the scene starts).

## Reusable compositions

A composition is a small layer arrangement (a name plate, a title card, a UI panel) that you design once and place in many scenes.

1. Select layers, right-click → **Save as reusable composition**.
2. Place it anywhere with **Add layer → Reusable compositions**. Each placement is a *Composition* layer with its own position, scale, opacity and animation.
3. To change it, right-click a placement → **Edit as layers**. Adjust the layers in the group, then right-click the group → **Update composition**. Every placement updates.

*Variables & characters → Reusable compositions* lists them with their number of uses, and lets you rename or delete them.
