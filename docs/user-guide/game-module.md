# Game module: inheritance, global elements, sprites, lists and collectibles

Version 0.3.0 turns pages into a small game engine. This page covers:

- **Page-to-page inheritance**: what keeps running when the story moves on.
- The **global page**: elements on every page.
- **Element variables**: sprites with frames, and parameters.
- **Lists and labels**.
- **Collectibles**: items the player picks up and uses later.

[中文版](game-module.zh-CN.md)

## Inheritance: what continues on the next page

When the story leaves a page, whatever is **still running** continues on the next page:

| Running | Continues |
| --- | --- |
| Audio or video that is playing (autoplay + loop, or started by a script) | The sound keeps playing without a restart. |
| An element moved by a **looping** animation that plays by itself | The element and its animation continue from where they were. |
| A **loop** (*forever*), a timer (*every n s*) or *when the mouse enters* script | The script starts again on the new page, together with the elements it uses. |
| Elements and scripts the page itself inherited | They pass through to the next page. |

On the new page the **Layers** panel lists these under **Inherited**, with the page they come from and a ▶ (running) or ⏸ (paused) mark. Their blocks appear in **Interactions → Elements → Inherited**, so the new page's scripts can use them. Double-click an inherited row to edit the element on its own page. The canvas draws inherited and global elements too; the 🌐 button in the canvas toolbar hides them.

Two blocks (*Game* category) decide what happens when the page changes. Put them in any script of the page; leave the element empty to mean *this script*:

- **When the page changes, remove [element]**: the element does not continue (media fall silent). With the element left empty, the script itself stays behind.
- **When the page changes, pause [element]**: the element continues but **paused**. It is still listed on the next page and in Interactions, but its media, animations and frame playback stop where they were. **Resume [element]** starts it again; with the element left empty, everything paused on that page resumes. **Pause [element]** and **[element] is paused** work on any page.

Rules:

- Music on the background-music channel is replaced by the next page's own music, as before.
- Only what is still running is inherited. A sound that finished, or a non-looping animation, stays behind.
- A group takes its contents along.
- Coming back to a page starts that page's own elements fresh; they are not inherited from it.

*Like Human*: the rain sound of *Rooftop* is still heard on the next rooftop page. That page then says *When the page changes, remove Rain* before the story goes indoors. *Memory* removes its old TV the same way.

## The global page

**Story → Global (every page)** opens the global page. It edits like any page:

- **Its elements are on every page.** Use them for background music, a HUD, an inventory, a health bar, a mute button…
- **Their state is shared.** An element hidden, moved or changed on one page stays that way on the next.
- **Its scripts run on every page.** They start again on each page.

You can also create global elements from anywhere:

- In **Add element → Global element**.
- In **Interactions → Game → New… → Global element**.
- With **Make global** in a layer's context menu, which moves the element and keeps its id, so scripts keep working.

Global elements are drawn in front of each page's elements. Set **Layer → Behind page elements** in the inspector for a global background. A global element can be moved back to a single page with **Move to this page only**.

## Element variables

Every element is also a variable that scripts can use. In **Interactions → Game**, the **Element variables** list shows the page's own elements, its inherited ones and the global ones. Double-click one (or its pill in *Elements*) to open its editor. There you can:

- rename it;
- **change its type** within related types: image ↔ sprite ↔ background, text ↔ button, detection area ↔ shape;
- choose its media, region shape or text;
- edit its **frames** (sprites) and its **parameters**.

### Sprites (characters made of frames)

**Add element → Game → Sprite**, or **Game → New… → Character**, creates a sprite. Its editor shows:

- an animated **preview**;
- its **frames**: add them from the library, from image files, or from an image element on the page; reorder, duplicate or delete them; drop an image onto a frame to replace it;
- its speed, looping and *play at start*.

Blocks:

| Block | Does |
| --- | --- |
| Show frame (n) of [sprite] | Stops and shows frame *n* (from 1). |
| Play [sprite] at (fps) frames/s | Plays forward, looping if the sprite loops. |
| Reverse [sprite] at (fps) frames/s | Plays backwards. |
| Play [sprite] once at (fps) frames/s and wait | Plays from frame 1 to the end, then continues the script. |
| Stop [sprite] | Stops where it is. |
| Add [media] to [sprite] as frame (n) | Inserts the picture of an image element (or another sprite's current frame) at frame *n*; empty = after the last frame. |
| frame of / number of frames of [sprite] | Values. |
| When [sprite] reaches its last frame | Event (non-looping playback). |

### Parameters

Any element can carry its own values: **Inspector → Parameters**, or the element editor. Each parameter has a name, a type (number, text, true/false) and a starting value; examples are *hp*, *speed* or *score*. Use them with:

- **Set [param] of [element] to ( )**;
- **Change [param] of [element] by ( )**;
- the value **[param] of [element]**, which works anywhere a number fits: *change hp of HUD by (damage of Enemy)*.

Parameters of global elements are kept from page to page.

## Global variables and lists

Variables are shared by every page. In **Interactions → Game → Global variables**:

- drag a variable into a slot to use its value;
- double-click it to change its name, **type** (number, text, true/false, **list**), scope and starting value.

A **list** holds several values. List blocks (*Variables* category):

- add to, insert at, replace item, delete item, remove a value, delete all;
- item *n* of, position of, length of, contains?

Positions start at 1; *last* and *random* are accepted. In expressions use `item(bag, 1)`, `length(bag)`, `count(bag, "Coin")` and `contains(bag, "Key")`. Text shows a list as `a, b, c`.

**Labels** show values on screen:

- **Show ( ) at x ( ) y ( ) as [label] size ( )** writes a value at a position and follows it live. Use it for an HP counter, a score or a timer. The same label name updates the label.
- **Show [list] at x y as [label]** writes a list, one item per line.
- **Hide label [name]**, with the name empty, hides every label.

Labels shown by global scripts stay on every page.

## Transform blocks

The *Game* category adds element transforms:

- turn by, point to, spin to (animated);
- move by x/y, glide by x/y;
- change size by %, scale to % (animated);
- change opacity by;
- fade in, fade out (show / hide with a fade);
- flip horizontally / vertically;
- bring to front, send to back;
- the value *angle of [element]*.

## Collectibles

The design: the player **collects** things on some pages and **uses** them later, to react on elements, unlock choices or take another path. It has five parts.

1. **Items** (*Variables & characters → Collectibles*, or *Game → New… → New item*). Each item has a name and an icon. Creating the first item also creates the list variable **inventory**. That list holds the names of collected items (duplicates count), so every list block and expression works on it.
2. **Collecting**:
   - **Pick up [element] as [item]** hides the element, adds the item and remembers it, so the element stays gone when the page is visited again. With the item empty, the element's name is used.
   - **Add (n) [item] to the inventory** adds items without an element.
   - **When [item] is collected** reacts to it.
3. **The inventory element** (*Add element → Game → Inventory*, usually on the global page). It shows the collected items as a grid with icons and counts. The player clicks one to **select** it.
4. **Using an item on an element**:
   - **When [item] is used on [element]** fires when the player selects the item, then clicks the element.
   - Inside, use **Take (n) [item] from the inventory**, show something, change a variable or continue the story.
   - **Select [item]** / *selected item* / *[item] is selected* work from scripts too.
5. **Item-locked choices**. In a choice's inspector:
   - **Needs item** makes the choice available only while the item is carried. *When unavailable* chooses whether it is hidden or shown disabled.
   - **Use up the item** takes the item when the choice is chosen.
   - Conditions can use `has("Key")` as well. Because choices are story ports, an item can open a different path.

Picked-up elements, the selected item and global elements are saved with the game.

*Like Human*:

- The old photo lies on the *Rooftop*. Clicking it picks it up, and the global inventory (top right) fades in.
- In *Memory* the choice *Give her the old photo* is available only with the photo. Choosing it uses the photo up and raises affection, which leads to the *Dawn* ending.
- *Boot sequence* has a three-frame sprite: the status light.
