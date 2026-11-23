# Scenes and layers

Open a scene node to get its **Composition** workspace: the canvas in the middle, the **Layers** list on the left, the inspector on the right and the dock below with the **Timeline** and **Interactions**. Everything in a scene is an element (a layer): pictures, characters, text, media, the dialogue and each choice. Every element has properties, keyframes on the timeline and its own effects. The **Script** tab shows the scene's dialogue and choices as text (see [Script view](#script-view)); the **Modules** tab holds module settings attached to this scene.

An empty scene shows **first steps** on the canvas: add a background (from your images, a new file or the image generator), a character, the dialogue, a text box, or switch to the Script view.

**More room for the canvas:** the buttons at the right of the scene header hide the Layers list and the dock (timeline and interactions); **Ctrl/⌘+\\** hides or shows both at once. A hidden dock keeps its tab row: click a tab to open it again. A canvas that was fitted to its area (**Ctrl/⌘+0**) stays fitted when panels open or close.

## Layers

**Add layer** (or drag an asset onto the canvas) creates layers:

| Layer | Use |
| --- | --- |
| Background | Fills the screen (cover / contain / stretch) with an image or a color |
| Image | Any picture |
| Character | A character with switchable portraits (expressions); follows the portrait chosen on each dialogue line |
| Text | Rich text with a typing reveal (animatable) |
| Text box | A box (size, padding, color, border, rounded corners) whose text wraps to fit it; aligned left, center or right and top, middle or bottom. When the text does not fit it can be cut off, shrink to fit, or run past the box. Dragging its handles resizes the box and the text re-wraps (hold **Alt** to scale instead) |
| Shape | Rectangles, ellipses, lines; fills, gradients, strokes, rounded corners |
| Button | A clickable button with text and styles |
| Hotspot | An invisible clickable area |
| Video | A video clip; plays in sync with the timeline when added as a clip |
| Audio | Music, ambience, sound effects or voice; music can continue into following scenes |
| Group | Holds other layers; transforms apply to its children |
| Composition | An instance of a reusable composition (see below) |
| Particles | Snow, rain, dust, sparkles, petals |
| Dialogue | The scene's lines (one per scene). Select it to write the lines in the inspector |
| Choice | One choice button. Its position, size, colors and animation are edited like any layer; its condition and effects are in the inspector |
| Detection area | An invisible rectangle, ellipse or polygon that reacts to the mouse (see [Interactions](scripting.md#detection-areas)) |
| Module layers | Added by modules, e.g. *Speech bubble* from the example modules |

**Add layer** groups the elements: *Media* (image, video, audio — pick a file from the library or import a new one), *Shapes* (rectangle, ellipse, triangle, line), *Text* (text, dialogue), *Interactive* (choice, button, detection area), then effects, structure and module elements. Elements can also be created from **Interactions** (*New element*). Copy, cut and paste elements with **Ctrl/⌘+C / X / V** — across scenes and projects too.

**Double-click** a text or text box on the canvas to type in it directly; click outside or press **Ctrl/⌘+Enter** to finish, **Esc** to cancel.

On the canvas: the mouse wheel zooms, dragging empty space pans, dragging a layer moves it, corner handles to scale, the round handle to rotate. **Shift** keeps proportions while scaling, locks movement to one axis and rotates in 15° steps; **Alt** temporarily disables snapping; arrow keys nudge (Shift ×10). Snapping to edges and centers can be switched off below the canvas. **Ctrl/⌘+G** groups layers. Lock and hide layers in the Layers list; drag to reorder or re-parent.

## The inspector: Options, Effects, Presets

Selecting an element shows three tabs at the top of the inspector:

- **Options** — every property of the element (name, position, size, text, style…), its **Parent** (see [Animation → Parent & link](animation.md#parent--link)), parameters and module settings. Properties with a ◆ button can be animated (see [Animation](animation.md)).
- **Effects** — the element's picture effect: edit its graph, save it as a preset, remove it, and key its parameters; the built-in effects (Glow, Blur, Dreamy bloom, Old film, Heat wave, Ripple, Pulse, Spin, Mood…) and **your saved effects** to apply with one click; and the blend mode.
- **Presets** — see below.

### Presets

- **Animation** — entrance (*Fade in*, *Slide in from left / right*, *Rise in*, *Pop in*, *Zoom in*, *Drop in*), emphasis (*Pulse*, *Shake*, *Bounce*, *Float*, *Wobble*, *Spin*, *Flash*) and exit (*Fade out*, *Slide out*, *Shrink out*). Set the length, place the playhead, click: the animation is written as ordinary keyframes in the current animation, starting from the element's current values, so you can adjust it on the timeline. Keys of the same properties inside that time are replaced.
- **Looks** — ready-made looks for text (Title, Subtitle, Caption, Outlined, Neon, Warm glow), shapes (Card, Glass, Outline, Accent, Shade), buttons (Primary, Ghost, Pill, Light, Danger) and free dialogue (Classic box, Speech bubble, Thought bubble, Neon box, Paper note, Text only). They change colors, fonts and shapes; position and content stay.
- **My presets** — save the current look of an element (its style properties, effect and blend mode — not its position or content) and apply it to other elements of the same kind, in any project.

## Dialogue and choices

Add a **Dialogue** layer (**Add layer → Dialogue**) and select it: the inspector lists the scene's lines in order.

- **Enter** creates the next line, **Shift+Enter** a line break, **Tab** cycles the speaker.
- Each line has a speaker (a character, a custom name, or narration) and optionally a portrait. Characters on stage switch to that portrait.
- Text supports `{variable name}` (replaced by its value) and markup: `[b]bold[/b]`, `[i]italic[/i]`, `[u]underline[/u]`, `[color=#ff6f9f]…[/color]`, `[size=1.4]…[/size]`, `[wave]…[/wave]`, `[shake]…[/shake]`, `[speed=2]…[/speed]` and `[wait=0.5]` (pause the typewriter).
- Lines can have a voice clip and per-line settings.

Add each choice with **Add layer → Choice**. Choices appear on the canvas, where they were placed, after the last line. Each choice adds an output to the scene node, labelled with its id (C1, C2 …); hover the output for a second to see the choice's text, condition and effects. See [Story flow](story-flow.md#choices-and-their-outputs).

### Script view

The **Script** tab next to *Composition* shows the scene's lines and choices as text, in the same format as [Importing a script](script-import.md):

```text
Mia: Good morning!
Mia (smile): The rain stopped.
The street is quiet.
* Go outside -> Street
* Stay in -> Room
```

Edits apply as you type (each pause is one undo step), and edits made in the dialogue list or the graph show up here. Lines and choices keep their identity by position, so translations, voices and choice styles stay attached. New speaker names become characters; `* Choice -> Scene` connects the choice to that scene of the same chapter, `-> Scene` (or `-> END`) sets where a scene without choices continues, and a choice or scene without `->` leads nowhere. Line breaks inside a line are written `\n`. The side panel inserts speakers, narration and choices, and lists anything it cannot connect.

### Free dialogue

**Add layer → Text → Free dialogue** adds a dialogue box that you place and style yourself, independent of the game's text box. Use it for speech bubbles next to characters, thoughts, signs, chat messages or a custom dialogue UI. Its inspector groups the settings:

| Group | Settings |
| --- | --- |
| Dialogue | Speaker, text (with `{variable}` and the same markup as dialogue lines), reveal (how much of the text shows) and typing speed |
| Box | Shape (rounded, rectangle, pill, ellipse, speech bubble, thought bubble or none), width, height (0 fits the text), padding, corner radius, fill, a second color for a gradient, outline, shadow, and the tail's side, position and size |
| Text | Font (including your own fonts), size, weight, italic, color, alignment, line height, letter spacing, outline and shadow |
| Name | Name position (in the box, a name tag above, or hidden), font, size, color, weight, and the name tag's colors |

It moves, scales, rotates and fades like every element. Every number and color can be keyframed on the timeline.

In Interactions:

- **[dialogue] says ( ) as ( ) wait** sets the text and speaker. With a typing speed above 0, the text types itself and the script can wait until it is done.
- **When [dialogue] finishes typing** reacts to the end of the typing.
- *Set text*, *set / change property* and the transform blocks work on it too.

### Your own fonts

Every font field has an **Upload** button that imports a `.ttf`, `.otf`, `.woff` or `.woff2` file into the project and selects it. Imported fonts are listed under *Imported* in every font menu, including the text box font in **Project settings**. The canvas, the preview and exported games all use them; exported games include only the fonts you use. Fonts can also be imported in **Assets**, which shows a sample in the font.

## Effects on elements

Effects belong to one element. Use the inspector's **Effects** tab, or the ✦ button on an element's row in the **Timeline**, to pick a preset or open its effect graph; the effect's parameters can be keyed like any property. For a full-screen effect, add a shape that covers the screen (a mask), and give that shape the effect. See [Effects](effects.md).

## Scene settings

Click empty canvas space to see the scene inspector: name, page number, background color, entrance transition, whether the text box is hidden, how long to stay on screen without dialogue, and **scene variables** (temporary values that reset each time the scene starts).

## Reusable compositions

A composition is a small layer arrangement (a name plate, a title card, a UI panel) that you design once and place in many scenes.

1. Select layers, right-click → **Save as reusable composition**.
2. Place it anywhere with **Add layer → Reusable compositions**. Each placement is a *Composition* layer with its own position, scale, opacity and animation.
3. To change it, right-click a placement → **Edit as layers**. Adjust the layers in the group, then right-click the group → **Update composition**. Every placement updates.

*Variables & characters → Reusable compositions* lists them with their number of uses, and lets you rename or delete them.
