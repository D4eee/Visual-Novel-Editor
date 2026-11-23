# Using Visual Novel Editor — a guide for AI agents

> **中文说明：**本文写给要用这个软件制作作品的 AI（也适合人快速上手）。读完后应能独立完成：搭建剧情流程图、编排场景画面、写对白和选项、做动画、加音乐/音效/配音、做交互、翻译和导出。要修改程序本身，请看 [DEVELOPING.md](DEVELOPING.md)。

This document describes Visual Novel Editor **1.1.1**. It tells an AI agent (or a new user) how to make a visual novel with the editor: the story graph, scenes and visuals, dialogue and choices, animation, sound, interactions, translations, testing and export. Each section gives the quickest way first, then the details.

How you can operate the editor:

| You are… | Use |
| --- | --- |
| The **built-in AI assistant** (✦ AI, Ctrl/⌘+J) | Its tools (§12). Each reply is one undo step |
| An agent **driving the UI** (browser automation, computer use) | The controls described here. **Ctrl/⌘+K** (command palette) reaches almost everything by name |
| An agent **writing files** | Plain-text scripts for **Import a script** (§4), or `project.vne.json` (§13, with care) |

The full manual for humans is the [user guide](../user-guide/README.md).

---

## 1. The model in one minute

- A **project** is a folder: `project.vne.json`, `assets/` (images, audio, video, fonts) and `modules/`.
- The story is split into **chapters**. Each chapter is a **graph** of nodes joined by connections.
- **Scene** nodes are the pages players see. Other nodes are logic: **Start**, **Condition**, **Random**, **Event**, **Wait**, **Jump In/Out**, **Ending**, **Note**.
- A scene contains **elements** (layers): background, images, characters, text, text boxes, shapes, buttons, hotspots, audio, video, particles, sprites, groups, compositions. It also contains one **Dialogue** element with its lines, and one **Choice** element per choice.
- Each choice is an output of the scene node, labelled C1, C2…; connect each to where it leads. A scene without choices has one *Next* output.
- Scenes have **animations** (timeline clips with keyframes), **interactions** (Scratch-style block scripts), and per-element **effects** (shader graphs).
- **Variables** (number, text, true/false, list) drive conditions, choice availability and text (`{name}`). **Characters** have a name, a color and **portraits** (named expression images).
- The **Global** page holds elements shown on every page, such as music and a HUD. Elements that keep running (looping music, looping animations, forever-scripts) carry over to the next scene automatically.

---

## 2. Screen map

| Area | Contents |
| --- | --- |
| Top bar | Project tabs, ✦ AI, undo / redo / 🕘 history, **Preview** (▾ for scope and language), 文A Translations, **Export**, modules, settings, language |
| Left rail | **Story** outline (chapters, scenes), **Assets**, **Data** (variables, characters, collectibles), module panels |
| Center | Tabs: the chapter **graph**, opened **scenes** (tabs *Composition* / *Script* / *Modules*), logic nodes |
| Scene → Composition | Layers list (left), canvas (middle), dock below with **Timeline** and **Interactions** |
| Inspector (right) | Properties of the selection; elements have *Options / Effects / Presets* tabs |
| Status bar | Save state, errors and warnings (click to open the problems list) |

The interface adapts to narrow windows. Panels tuck away and open over the work area from their buttons. In a scene, **Ctrl/⌘+\\** hides the layers list and the dock to give the canvas all the room.

---

## 3. Start a project

1. Home → **New project** → name and folder → **Create**. You get chapter 1 with **Start → first scene → Ending**.
2. Or open the example **Like Human** (Home → Examples), which uses every feature, and copy what you need.
3. Import media: **Assets** panel → drop files, or **Import**. Assets are referenced by name in scripts (`[bg: name]`, `[voice: name]`).
4. Add characters: **Data** → *Characters* → **+**. Give each a name, a color and portraits, for example *smile*, *angry*, *sad*, each with an image.

---

## 4. Write the story fast: scripts

The quickest way to create many scenes is **Import a script** (story graph toolbar → 📄, or Ctrl/⌘+K → "Import a script"). Paste text in this format:

```text
# Chapter one                    ← optional: starts a new chapter
## Morning                       ← starts a scene named "Morning"
[bg: #2a3350]                    ← background color, or [bg: image asset name]
[music: bgm_city]                ← background music by asset name
The alarm rang for the third time.          ← narration
Mia: Five more minutes…                     ← dialogue by Mia (created if missing)
Mom (angry): You'll be late again!          ← with Mom's portrait "angry"
[voice: mom_03]                  ← voice clip for the NEXT line
> Note: narration that contains a colon
* Get up -> Kitchen              ← a choice leading to scene "Kitchen"
* Stay in bed -> Late

## Kitchen
Mom: Breakfast is ready.
-> END                           ← continue to an ending (or "-> Scene name")

## Late
// comments start with //
-> END
```

Rules:
- A scene without `*` choices and without `->` continues to the **next scene** in the same chapter.
- Choice and `->` targets are scene names, either in the script or already in the same chapter. `END` (or `结束`) adds an Ending node.
- Full-width colons and brackets work: `小美（开心）：早上好！`. `Narrator:` / `旁白：` lines are narration.
- The importer creates the scenes, dialogue elements, choice elements, characters and connections, lays the scenes out in the graph, and lists anything it could not resolve. The whole import is one undo step.

**Edit one scene as text:** open a scene → **Script** tab. It is the same format without `#`/`##`. Changes apply as you type and stay in sync with the dialogue list and the graph. Line breaks inside a line are written `\n`.

---

## 5. The story graph

| Do | How |
| --- | --- |
| Add a node | Toolbar buttons (scene, condition, event, jump in/out, ending, ⋯ more), double-click empty space, or **Tab** |
| Connect | Drag from an output (right) to an input (left); drag from an output into empty space to create a connected node |
| Disconnect | Drag the connection off its input and drop it on empty space |
| Open a scene | Double-click it (or Enter) |
| Move between chapters | Drag nodes onto a chapter in the Story outline |
| Overview | "All chapters" in the outline shows every chapter |

Node types:

| Node | Use |
| --- | --- |
| Start | Where the game begins (one per project) |
| Scene | A page: visuals, dialogue, choices, animation, scripts |
| Condition | Branch on an expression of variables: *True* / *False* outputs |
| Random | Weighted random branches |
| Event | Run actions while passing (set variables, play sounds…) |
| Wait | Pause while the current scene stays on screen |
| Jump In / Jump Out | Same number = teleport; links chapters and keeps big graphs tidy |
| Ending | Ending card; can unlock a persistent variable; then title / restart / quit |
| Note | Sticky note, never runs |

Expressions (conditions, choice conditions) are built in the expression editor: variables, numbers, text, `= ≠ < ≤ > ≥`, `and / or / not`, arithmetic, and the functions `random(a,b) min max abs round floor length item count upper lower has`. Examples: `has("Key")` (the player carries the collectible), `count(inventory, "Coin") ≥ 3`.

Branching recipe:
1. Add choices to a scene.
2. Give a choice **effects** (for example *trust +1*) in its inspector, or a **condition** so it shows only when the condition is true (or shows disabled).
3. Later, a **Condition** node routes on `trust ≥ 2`.

---

## 6. Build a scene (visuals)

Open a scene. An empty scene shows quick-start cards: **Background, Character, Dialogue, Text box, Write as text**. Otherwise use **Add layer** (below the canvas or **+** in the layers list).

| Element | How to use it |
| --- | --- |
| Background | Fills the stage with an image (cover / contain / stretch) or a color |
| Character | Pick a character; it shows the portrait of its latest dialogue line. Props: height, flip, dim |
| Image | Any picture, positioned freely |
| Text | Rich text, optional wrap width, typing reveal |
| **Text box** | A box (size, padding, color, border, radius) whose text **wraps to the box**. Align left/center/right and top/middle/bottom. Overflow: cut off, shrink to fit, or run past. Drag its handles to resize (the text re-wraps); Alt-drag scales |
| Shape | Rectangle, ellipse, triangle, line; gradients, stroke, radius |
| Button / Hotspot / Detection area | Clickable things for interactions |
| Video / Audio | Media (see §8) |
| Particles | Snow, rain, dust, sparkles, petals |
| Group / Composition | Organize; compositions are reusable (see §7) |
| Sprite, Inventory | From the Game module: frame animations, item lists |
| Free dialogue | A dialogue box you place yourself (speech bubbles, chat UIs) |

Canvas handling:
- Drag to move, corner handles to scale, the round handle to rotate.
- **Shift** keeps proportions, locks an axis, or snaps rotation to 15°.
- **Alt** disables snapping; arrow keys nudge (Shift ×10).
- **Double-click a text or text box to type in it.**
- **Ctrl/⌘+G** groups; Ctrl/⌘+C/V copies and pastes across scenes and projects; Ctrl/⌘+0 fits the view.

Inspector:
- The **Options** tab holds all properties; numbers can be dragged.
- **Effects** add shader effects (blur, glow, color grading, distortion…) from presets or a node graph.
- **Presets** apply ready animations (fade in, pop in, slide in, shake, pulse, float, fade out…) and saved looks.

Draft images: Assets → **Generate images** (needs an image service key in *Settings → Image generation*). Choose *Background* (stage-shaped) or *Character sketch* (portrait), then **Add to assets** or **Use as background**.

---

## 7. Dialogue and choices

- Select the **Dialogue** element. The inspector lists the lines: **Enter** adds a line, **Tab** cycles the speaker, and each line has a speaker, a portrait, a voice clip and an auto-advance delay. Or use the **Script** tab (§4).
- Text markup: `{variable}`, `[b]…[/b]`, `[i]…[/i]`, `[u]…[/u]`, `[color=#ff6f9f]…[/color]`, `[size=1.4]…[/size]`, `[wave]…[/wave]`, `[shake]…[/shake]`, `[speed=2]…[/speed]`, `[wait=0.5]`.
- **Choices** are elements (**Add layer → Choice**). Position and style them on the canvas. In the inspector, set the text, condition, *when unavailable* (hide or disable), effects on variables, *hidden* (a script reveals it), and an animation to play when chosen.
- Each choice adds an output to the scene node (C1, C2… top to bottom). Connect them in the graph.
- Scene settings (select nothing): background color, **entrance transition** (fade, dissolve, slide; duration, color), *hide the text box*, hold time when there is no dialogue, scene variables.

---

## 8. Sound

| Goal | How |
| --- | --- |
| Background music | Add an **Audio** element: channel *Music* (bgm), autoplay on, loop on. With *Keep playing into the next scene* on (persist), it continues into following scenes until another track replaces it or a script stops it. For music everywhere, put it on the **Global** page |
| Ambience | Audio element, channel *Ambience*, loop |
| Sound effect at a moment | Script: `When [element] is clicked → Play sound [sfx]`; or sync an audio element with the timeline (below) |
| Voice acting | Per dialogue line: choose a **voice** clip (or `[voice: name]` in scripts). Players can replay voices from the log; auto mode waits for voices to finish |
| Sync sound with animation | Select the audio/video element → **Sync with timeline**. Its clip shows in the timeline with a **waveform**; drag to set the start, drag the edges to trim, and key motion to the beats |
| Volume / fades | Animate the element's volume on the timeline, or use script blocks |

Players set music, sound and voice volumes in the game's Settings.

---

## 9. Animation

Open the **Timeline** in the scene dock.

1. **New animation** creates a clip. Set its *length*, *Loop* and *Autoplay* (autoplay clips start with the scene).
2. Select an element. In its row, open a property group (Transform, Size, Text, Style, Effect) and click a property's **stopwatch**: a keyframe is made at the playhead.
3. Move the playhead, then change the value (drag the number, use the inspector, or move the element on the canvas). The key is set. Turn **Record** on to key every change.
4. Right-click a key → **Interpolation**: linear, hold, ease in / out / in-out, back, elastic, bounce, or a **bezier** curve. **F9** applies an easy ease. **G** opens the graph editor.
5. **Layer bars** set when an element appears and disappears (in/out points). **Markers** (M) and the **work area** (B/N) help with timing.
6. **Parent link** (🔗 in a row): an element follows another one's movement, rotation and scale.
7. **Expressions:** click **=** on a property and type a formula:
   - `follow("Mika", 0.2)` follows Mika's value 0.2 s later;
   - `value + wiggle(2, 10)` wobbles around the keyed value;
   - `loop()` repeats the keys;
   - `value + sin(time * 3) * 20` swings.

   Available: `time`, `value`, `pi`, `follow`, `wiggle`, `loop`, `noise`, `sin`, `cos`, `abs`, `min`, `max`, `clamp`, `lerp`, `step`, `round`, `floor`, `ceil`, `sqrt`, `+ - * / % ^`, comparisons, `a ? b : c`.
8. **Precompose:** right-click elements → *Precompose* to turn them and their animation into a reusable **composition**. Instances have *Starts at*, *Speed* and *Playback* (once, loop, back and forth). Add compositions from **Add layer → Compositions**.

Animations can be played by scripts (*Play animation [and wait]*), by choices (an animation on pick), or by tweens (*Tween* blocks animate one property without a clip).

Keyboard (timeline focused):

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Move one frame |
| J / K | Previous / next keyframe |
| Home / End | Start / end |
| I / O | Element in / out point |
| M | Add a marker |
| U | Show only animated properties |
| G | Graph editor |
| F9 | Easy ease |

---

## 10. Interactions (scripts)

The **Interactions** tab in the dock holds Scratch-style block scripts for the scene. Blocks snap together, and the notch shapes show what fits.

- **Hat blocks** start scripts:
  - when the scene starts or ends;
  - when an element is clicked, or the mouse enters or leaves it;
  - when a key is pressed, an animation finishes, or a media clip ends;
  - when a variable changes, a line is shown, the dialogue ends, or a choice is selected;
  - when a message arrives; after *n* seconds or every *n* seconds.
- **Categories:**
  - Events, Control (wait, if, repeat, forever, stop, broadcast);
  - Looks (show, hide, set or change or tween a property, play animation, set text or image or portrait, shake or flash the screen, glide, rotate, scale, fade);
  - Sound, Sensing (mouse, touching, timer, keys), Operators, Variables (and lists);
  - Story (show or hide a choice, go to a line, advance, continue, go to a node);
  - Game module (sprites, collectibles, inventory).
- Every element row lists the blocks for that element. **New element** creates elements from the Interactions side.
- **Test** runs the scene docked in the canvas and highlights blocks as they run.

Example (hidden choice):

```
When [Mika] is clicked
  Play animation [Mika waves] and wait
  Change [trust] by 1
  Play sound [sfx_beep]
  Show choice [Take her hand.]
```

**Event** nodes in the graph run the same kinds of actions between scenes. **Reusable behaviors** (Data panel) are scripts shared by many scenes.

---

## 11. Translations, testing, export

- **Translations** (文A in the top bar):
  1. Choose the original language and the target languages.
  2. Translate in the table, or with **Translate with AI**, or export CSV, translate it, and import it.
  3. Choose a preview language with Preview ▾. Players switch language in the game's settings.
- **Preview** (Ctrl/⌘+P): the current scene, the chapter, or the whole game, played by the same engine as exported games.
  - The debug panel shows variables, the path taken, events and errors; fold it for a bigger picture.
  - Games include save and load, quick save (F5/F9), the log with voice replay, auto mode, and skip that stops at unread text.
- **Problems:** the status bar lists errors and warnings, such as unconnected outputs, unreachable nodes, missing assets and empty choices. Fix errors before exporting.
- **Export** (Ctrl/⌘+E):
  - Game name, version, author, icon, resolution and window mode.
  - Platforms: macOS (Apple silicon / Intel), Windows, and web (a folder for any web host).
  - Only used assets and modules are included.

---

## 12. The built-in AI assistant's tools

The assistant (✦ AI, Ctrl/⌘+J; set a Claude or OpenAI-compatible key in *Settings → AI assistant*) works through these tools. An agent connected to the assistant should prefer them over clicking.

| Tool | Does |
| --- | --- |
| `get_project_overview`, `get_scene` | Read the project and one scene in detail |
| `view_scene` | A picture of a scene's stage (vision models) |
| `list_element_types`, `list_blocks` | Available element types (and their properties) and blocks |
| `create_scene`, `connect_nodes`, `update_node`, `delete_nodes`, `create_chapter` | Story graph |
| `import_script` | Create many scenes from the script format (§4) |
| `add_character`, `add_dialogue_lines`, `edit_dialogue_line`, `add_choice` | Characters, lines, choices |
| `add_element`, `set_element_props`, `delete_elements`, `set_element_parent` | Elements |
| `add_keyframes`, `apply_animation_preset`, `apply_look` | Animation and styling |
| `add_script`, `set_variable` | Interactions and variables |
| `set_project_settings` | Title, resolution, text speed, text box style |
| `generate_image` | Draft a background or character sketch (costs money; only when asked) |
| `open_in_editor` | Show the user a scene or node |

Tips for agents:
- **Read first.** Call `get_project_overview`, then `get_scene` for the scene you change.
- **Prefer `import_script`** for many lines or scenes.
- **Check visually** with `view_scene` after layout changes.
- **Coordinates:** stage pixels, origin top-left, size `settings.resolution` (default 1280×720). Elements are positioned by their anchor (default center, `anchorX/anchorY = 0.5`).
- The user can undo everything you do; in *Read-only* mode the assistant can only look.

---

## 13. Editing `project.vne.json` directly (advanced)

Prefer the editor, scripts or the assistant. If you must write JSON:

- **Format:** `format: "vne.project"`, `formatVersion: 5`. Close the project in the editor first, and keep a backup. The editor also keeps backups in `.vne/`.
- **Ids:** unique strings, conventionally prefixed (`nod_`, `lyr_`, `chr_`, `ast_`, `cmp_`, `trk_`…). Never reuse an id. Translations, connections and scripts point at ids.
- **Edges:** `{ id, from: { node, port }, to: { node, port } }`. A scene's outputs are `next`, or `c:<choiceLayerId>` per choice. Most inputs are `in`.
- **Scenes:**
  - Dialogue is the layer of type `core.dialogue` with `props.lines: [{ id, speakerId, portraitId?, text, voiceAssetId?, auto? }]`.
  - Each choice is a `core.choice` layer with `props.text` (plus `condition`, `effects`, `hidden`…).
- **Assets** must exist under `assets/` and be listed in `project.assets` with `kind` and a relative `path`.
- **Validate** by opening the project: the editor migrates older formats, and the problems list reports broken references.

---

## 14. Shortcuts worth knowing

| Keys | Action |
| --- | --- |
| Ctrl/⌘+K | Command palette: go to anything, run commands (`>` for commands only) |
| Ctrl/⌘+Z / Shift+Z | Undo / redo |
| Ctrl/⌘+Shift+H | History: jump to any earlier step |
| Ctrl/⌘+S | Save (autosave also runs) |
| Ctrl/⌘+P | Preview |
| Ctrl/⌘+E | Export |
| Ctrl/⌘+J | AI assistant |
| Ctrl/⌘+\\ | Canvas only (hide layers and timeline) |
| Ctrl/⌘+, | Settings |
| F1 | All shortcuts |
| Tab (graph) | Add a node |
| F (graph/canvas) | Frame everything |

See also: [user guide](../user-guide/README.md) · [glossary](../user-guide/glossary.md) · [scripting](../user-guide/scripting.md) · [animation](../user-guide/animation.md) · [modules](../user-guide/modules.md)
