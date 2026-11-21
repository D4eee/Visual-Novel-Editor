# User guide

Visual Novel Editor is a desktop application for making visual novels and other branching stories, and exporting them as standalone games for macOS and Windows.

- [Getting started](getting-started.md) — your first project in ten minutes ([中文](getting-started.zh-CN.md))
- [The story flow graph](story-flow.md) — chapters, nodes, choices, conditions, jumps and endings
- [Scenes and layers](scenes.md) — composing a scene, dialogue, choices, characters
- [Animation](animation.md) — timeline, keyframes, interpolation curves, audio and video sync
- [Effects](effects.md) — procedural effect graphs, presets and shaders
- [Interactions (visual scripting)](scripting.md) — blocks, triggers and reusable behaviors
- [Game module](game-module.md) — page-to-page inheritance, global elements, sprites, parameters, lists and collectibles ([中文](game-module.zh-CN.md))
- [Assets](assets.md) — importing, previews, usage, missing files and relinking
- [Variables and characters](data.md)
- [Modules](modules.md) — installing and using extensions
- [Preview and debugging](preview.md)
- [Exporting your game](export.md)
- [Projects, saving and recovery](projects.md)
- [Keyboard shortcuts](shortcuts.md)
- [Glossary / 术语表](glossary.md)

## The window at a glance

| Area | What it is for |
| --- | --- |
| **Top bar** | Project tabs, undo/redo, **Preview** (with a scope menu), **Export**, modules, project settings, shortcuts, interface language |
| **Left rail** | Story outline (chapters and nodes), Assets, Variables & characters, and panels added by modules |
| **Center** | The open workspace: the story graph of a chapter, a scene's composition, or a node's logic workspace. Tabs keep several open |
| **Bottom dock** (scenes) | Timeline (keyframes, media and effects of every element) and Interactions (scripts, with Test) |
| **Right** | Inspector for whatever is selected |
| **Status bar** | Save state, number of errors and warnings (click to open the Problems list), project location |

Hints are kept out of the way: hover a control, a title or a field label for about 1.5 s to see what it does. On every canvas the mouse wheel zooms and dragging empty space pans.

Everything you change can be undone (**Ctrl/⌘+Z**) and redone (**Ctrl/⌘+Shift+Z**).
