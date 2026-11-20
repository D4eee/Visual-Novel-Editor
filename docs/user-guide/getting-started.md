# Getting started

This walk-through builds a tiny two-route story, previews it and exports it.

## 1. Install and launch

- **macOS** – open the `.dmg` and drag *Visual Novel Editor* to Applications. The build is not notarized: the first time, right-click the app → **Open**.
- **Windows** – run the installer (`Visual Novel Editor Setup.exe`) or unzip the portable build.
- **From source** – `npm install`, then `npm start` (see the main README).

The interface follows your system language (English or Simplified Chinese). Switch any time with the language button in the top-right corner.

## 2. Create a project

On the Home screen choose **New project**, give it a name and pick a folder. The editor creates:

```
My Story/
  project.vne.json     ← the whole story (versioned JSON)
  assets/              ← imported images, audio, video, fonts
  modules/             ← modules installed into this project
  .vne/                ← autosave and backups (safe to ignore)
```

A new project already has one chapter, a **Start** node and a first scene.

Want to look around first? Under **Examples**, *Like Human* uses every feature. **Copy as new project** gives you your own copy.

## 3. Write the first scene

1. Double-click the scene node in the graph (or select it and press **Enter**). The scene opens in its own tab.
2. In **Assets** (left rail), drop a background image and a character image onto the panel to import them.
3. Drag the background asset onto the canvas — it becomes a background layer.
4. In **Variables & characters**, add a character, give it a name and color, and add a portrait using the character image. Back in the scene, **Add layer → Character** and pick the character.
5. In the **Dialogue & choices** dock, type a line. **Enter** adds the next line, **Tab** switches speaker.
6. Add two choices with **Add choice**: *“Go left”* and *“Go right”*.

Each choice becomes its own output port on the scene node.

## 4. Branch the story

Go back to the chapter tab. Drag from the *Go left* port into empty space and pick **Scene** — a connected scene is created. Do the same for *Go right*. Finish both routes with an **Ending** node.

The status bar shows problems as you work, such as an output that leads nowhere. Click it to open the Problems list; clicking a problem takes you to it.

## 5. Preview

Press **Preview** (or **Ctrl/⌘+P**). The preview uses exactly the same runtime as exported games. The arrow next to Preview chooses where to start: the current scene, the start of the chapter, or the start of the game. The debug side panel shows variables (editable while playing), the path taken and events.

## 6. Export

Press **Export**. Pick platforms — macOS (Apple Silicon or Intel), Windows, or Web — and an output folder, then **Export**. The first export for a platform uses the bundled runtime (or downloads it once if your editor build did not include it). See [Exporting](export.md) for signing notes.

## Next steps

- Add animation on the [Timeline](animation.md)
- Make things clickable with [Interactions](scripting.md)
- Try [Effects](effects.md) and [Modules](modules.md)
