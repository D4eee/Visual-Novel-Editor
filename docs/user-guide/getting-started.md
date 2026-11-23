# Getting started

This walk-through builds a tiny two-route story, previews it and exports it.

## 1. Install and launch

Download from the [releases page](https://github.com/D4eee/Visual-Novel-Editor/releases):

- **macOS (desktop)** – unzip `…-mac-arm64.zip` (Apple Silicon) or `…-mac-x64.zip` (Intel) and move *Visual Novel Editor.app* to Applications. The build is not notarized: before the first launch run once in Terminal `xattr -cr "/Applications/Visual Novel Editor.app" && codesign --force --deep --sign - "/Applications/Visual Novel Editor.app"`. Then open it like any app.
- **Windows (desktop)** – unzip `…-win-x64.zip` and run *Visual Novel Editor.exe*.
- **Web edition** – unzip `…-web.zip` and double-click *Start Visual Novel Editor.command* (macOS) or *start-windows.bat* (Windows); needs Node.js 20+. The editor opens in your browser.
- **From source** – `npm install`, then `npm start` (see the main README).

The desktop editions include the example games, the example modules and everything needed to export games, and work offline. Opening an example from the Home screen opens your own copy of it.

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

A new project already has one chapter, a **Start** node, a first scene and an ending. The first time you open a project, a short tour points out the main parts of the editor (replay it from the command palette, **Ctrl/⌘+K**).

Want to look around first? Under **Examples**, *Like Human* uses every feature. **Copy as new project** gives you your own copy.

## 3. Write the first scene

1. Double-click the scene node in the graph (or select it and press **Enter**). The scene opens in its own tab.
2. In **Assets** (left rail), drop a background image and a character image onto the panel to import them.
3. Drag the background asset onto the canvas — it becomes a background layer.
4. In **Variables & characters**, add a character, give it a name and color, and add a portrait using the character image. Back in the scene, **Add layer → Character** and pick the character.
5. **Add layer → Dialogue**, then type a line in the inspector. **Enter** adds the next line, **Tab** switches speaker. Or open the scene's **Script** tab and type the lines as text: `Mia: Hello!`.
6. **Add layer → Choice** twice and name the choices *“Go left”* and *“Go right”* (the text is in the inspector). Place them on the canvas where they should appear.

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
