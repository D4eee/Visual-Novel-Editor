# Animation

Each scene can hold several **animations** (clips). Open the **Timeline** tab in the scene dock. The timeline works like After Effects: every element has a row with a **layer bar**, and opens into **property groups** (Transform, Size, Text, Style, Effect…).

## The timeline at a glance

| Part | What it does |
| --- | --- |
| **Head** | Animation picker, ⏮ start, ◀ ▶ previous / next frame, Play, Record, time (seconds or timecode, see *Settings → Editing*), length, Loop, Autoplay; on the right: marker, work area, *only animated properties* (U), **graph editor** (G), shortcuts, zoom |
| **Ruler** | Click or drag to move the playhead (it snaps to keys, markers and in/out points; Shift = no snapping). Markers (yellow flags) and the work area (blue band) sit here |
| **Element row** | Twisty, name, **parent** (🔗), add a property, effect menu; on the right the **layer bar** |
| **Group row** | Transform, Size, Text, Style, Effect… — opens and closes; a group shows how many of its properties are animated |
| **Property row** | **Stopwatch**, name, value (drag left/right to change it, click to type), **◀ ◆ ▶** keyframe navigator, and its keyframes |

## Keyframes

- **Stopwatch** — turn it on to animate a property: a keyframe is made at the playhead with the current value. Turning it off removes all of the property's keys (undoable).
- **◆** adds or removes a key at the playhead; **◀ ▶** jump to the property's previous / next key. Double-click a lane to add a key there.
- Change a value while a property is animated (drag the number, use the inspector or move the element on the canvas) and the key at the playhead is set — or a new one is made. Switch on **Record** to make keys for any property you change.
- **Select**: click a key, Shift/⌘-click to add, drag a **box** on empty lane space, click a property name to select all its keys, ⌘/Ctrl+A for all keys.
- **Move** keys by dragging; they snap to the playhead, other keys, markers and in/out points, otherwise to whole frames. Shift moves freely.
- **Alt-drag** a key of a selection to **stretch** the selected keys in time around the first one.
- ⌘/Ctrl+C / V copy and paste keys at the playhead (onto the selected element when the keys came from one element). Delete removes them.
- Colors and numbers interpolate; other values (text, images, booleans) switch at the keyframe.

Any property marked animatable can be keyed — transform, opacity, colors, text reveal, effect parameters, and properties added by modules.

## Interpolation and curves

Right-click a keyframe → **Interpolation**: *Linear*, *Hold* (step), *Ease in*, *Ease out*, *Ease in-out*, *Back*, *Elastic*, *Bounce* or a **Bezier** curve. **F9** (*Easy ease*) gives the selected keys a smooth ease in-out. **Edit easing curve…** (or double-click a key) opens a small curve editor. The default ease for new keys is set in *Settings → Editing*.

### Graph editor

Press **G** (or the graph button) to switch the lanes to the **graph editor**: the value curves of the properties you pick.

- Click property names to choose which curves are shown (Shift adds). Without a choice it shows the properties with selected keys, then the selected element's.
- Drag keys up/down to change values and left/right to retime them; Shift keeps the move on one axis. Drag a box to select keys.
- Selected keys show **bezier handles** for the curve segments next to them. Dragging a handle turns that segment into a custom bezier curve — the shape of the motion between the two keys.

## Elements in time: layer bars

The bar on an element's row is the time it is **shown** in this animation.

- Drag an edge to set the **in** or **out** point (Alt+[ / Alt+] set them to the playhead; I / O jump to them). Outside its bar the element is hidden while the animation plays.
- Drag the bar to move the element in time — its keyframes and media clips move with it.
- Double-click or right-click → *Show for the whole animation* removes the in/out points.

## Parent & link

Click 🔗 on an element row (or **Parent** in the inspector's Options) and pick another element: the element now follows its parent's position, rotation and scale — like After Effects' parent pick-whip. Its own position is measured from the parent's anchor point; it stays where it is when you link or unlink (its values and keys are converted). Unlike a group, it keeps its own place in the layer order and its own opacity. Both elements must be in the same group.

## Motion paths

Select an element whose position is animated: the canvas shows its **motion path** (dashed) with a ◆ per position key. Drag a ◆ to move that key on the stage; the playhead jumps to it.

## Markers and the work area

- **M** adds a marker at the playhead. Drag markers to move them, double-click to name them, right-click to delete. Keys and the playhead snap to markers.
- The **work area** is the part of the animation the editor plays and loops (it does not change the game). Turn it on with its button, set its ends with **B** / **N**, or drag them. Home / End jump to its ends (Shift: to the whole animation's).

## Shortcuts (timeline focused)

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → (Shift: ×10) | Previous / next frame |
| J / K (or , / .) | Previous / next keyframe |
| Home / End | Start / end (of the work area) |
| I / O | Go to the element's in / out point |
| Alt+[ / Alt+] | Trim in / out point to the playhead |
| B / N | Work area start / end at the playhead |
| M | Add marker |
| U | Only animated properties |
| G or Shift+F3 | Graph editor |
| F9 | Easy ease selected keys |
| ⌘/Ctrl+A, C, V, Delete | Select all, copy, paste, delete keys |
| Ctrl/⌘ or Alt + wheel | Zoom time (wheel alone scrolls) |
| Alt+drag empty space / middle button | Pan |

## Animation presets

In the inspector's **Presets** tab, ready-made animations (entrance, emphasis, exit — *Fade in*, *Pop in*, *Slide in*, *Shake*, *Pulse*, *Float*, *Fade out*…) are written as ordinary keyframes at the playhead, with the length you choose. See [Scenes and layers](scenes.md#presets).

## Audio and video on the timeline

Select an audio or video element and choose **Sync with timeline** (or *+ → Sync with timeline* on its row). Its clip appears in the timeline: drag it to set the start, drag its edges to trim. While you scrub, video frames follow the playhead; in the game the media starts and stops with the animation.

## Playing animations

- **Autoplay** clips start when the scene starts.
- Scripts: *Play animation* (optionally *and wait*), *Stop animation*, *When animation finishes*.
- Choices: a choice can play an animation when picked.
- *Tween* blocks animate one property without a clip, with any interpolation.

In the editor, **Play** in the timeline previews the clip on the canvas (looping the work area when it is on). **Preview** plays the scene for real.
