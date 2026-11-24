# Characters: skeletons, motions and expressions

**English** · [User guide](README.md)

A character can be more than a set of portraits. In the **Character studio** you give it a skeleton of image parts, motions and expressions. Character elements on stage play them, and the timeline and interactions decide what plays when.

Open the studio in one of these ways:

- **Data panel:** open a character and click **Character studio**.
- **Inspector:** select a character element and click **Edit skeleton, motions and expressions…**.
- **Command palette (Ctrl/⌘+K):** run *Character studio: \<name\>*.

The preview is on the left and the four tabs are on the right. Every change can be undone. Click **Done** or press Esc to close.

## Skeleton

A skeleton is a tree of **bones**, and image **parts** hang on the bones. When a bone moves or turns, its children and parts follow.

You can start a skeleton in three ways:

- **From the portrait:** makes a root bone at the feet, a body bone, and one part showing the portrait.
- **Empty skeleton:** a root bone in a 600 × 900 box.
- **Import tab:** from Spine, or from layered images (see [Import](#import)).

To edit the skeleton:

- **Select:** click a joint (the round handle) or a part on the preview, or pick it in the **Bones** and **Parts** lists.
- **Move or turn:** drag on the preview to move the selection. Hold Shift and drag to rotate it. You can also type position, rotation, scale and length in the fields.
- **Bones:** **+** adds a child of the selected bone. Deleting a bone hands its children and parts to its parent.
- **Parts:** the image button adds a part from an image asset. The list shows the drawing order with the front part on top; use the arrows to reorder.
- **Several images per part:** a part can hold eyes open / closed or mouth shapes. Add them with **Add image**; the radio button picks the one shown at rest.
- **Size and origin:** the box the character is drawn in, and the point that stands on the element's position (usually the feet).

## Motions

A motion is one of two kinds:

| Kind | What it is |
| --- | --- |
| **Skeleton motion** | Keyframes of bones (move, turn, scale) and parts (which image, opacity), with easing |
| **Image sequence** | Frames played at a set number of frames per second |

**Set keys on a skeleton motion:**

1. Select the motion and a bone or part.
2. Move the playhead under the preview.
3. Drag a joint (Shift turns it), or change a value in the key fields. A key is written at the playhead.

The ◆ button next to a field adds or removes a key. Click a key time to jump to it; right-click it to change its easing or remove it.

Bone values in a motion add to the rest pose (move and turn) or multiply it (scale), so one motion fits the skeleton even after you adjust the rest pose.

**Idle and looping:**

- **Idle motion:** one motion plays whenever nothing else does.
- **One-shot motions:** a motion that does not loop goes back to idle when it ends.
- **Speed:** a character element's **Motion speed** plays its motions faster or slower.

## Expressions

An expression changes how parts look:

- **Images and opacity:** the image and opacity of each part (for example closed eyes, a blush part at full opacity).
- **Small pose changes:** select a bone and drag it, or type an offset.
- **Without a skeleton:** an expression can name a portrait, so the same expression works for simple characters too.

Expressions combine with motions: a character can wave while it is angry.

## Import

- **Spine:** export JSON with a texture atlas from Spine 3.8 or 4.x. Then choose the `.json`, the `.atlas` and every page image together.
  - **Comes across:** bones, slots and their images, image swaps, moves, turns, scales and fades. Animations become motions, and the one named *idle* becomes the idle motion.
  - **Simplified:** meshes are drawn as flat images.
  - **Left out:** shear, IK and other constraints, draw-order and deform timelines, and skins other than the default. The studio lists what was left out.
  - **Replacing a skeleton:** importing again replaces the skeleton and its skeleton motions. Image sequences stay.
- **Image sequence:** choose frame images (`walk_01.png`, `walk_02.png`…). They are sorted by name and become a looping motion.
- **Parts from layered images:** images exported layer by layer at the same size (body, hair, eyes…) are stacked as parts on the root bone. Then add bones and move each part to its bone.

Live2D (`.moc3`) models are not supported. For Live2D-style breathing, blinking and swaying, use a skeleton with image swaps and gentle looping motions.

## On stage

A character element shows the character's skeleton (or image sequence) when it has one. Its **Options** have:

- **Motion:** what plays. Leave it empty for the idle motion.
- **Expression:** the expression shown.
- **Motion speed:** faster or slower playback.
- **Show:** *Skeleton or motion when there is one*, or *Portrait only*.

You can drive these from the timeline or from interactions:

- **Timeline:** key **Motion** like any other property. Each key starts its motion from the beginning at that time. **Expression** can be keyed too.
- **Interactions:** **Play motion** starts a motion on an element (tick *wait* to continue only when it ends), and **Set expression** changes the expression.

Exported games include the images the skeleton uses and nothing else.

## Character library

Save a character to your **library** with **Save to library**. The button is in the studio, in the Data panel, and in the **Characters** section of the inspector's **Presets** tab.

The library lives in your user folder, so every project can use it:

- **Add to project:** adds a copy of the character and imports its images.
- **Use on this element:** with a character element selected, adds the character and shows it on that element.

See also [Presets → Scenes](scenes.md#scenes-in-your-library) for whole sets.
