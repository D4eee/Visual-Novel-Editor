# Projects, saving and recovery

A project is a folder. `project.vne.json` holds the whole story in a versioned JSON format with stable ids; `assets/` and `modules/` hold its files. The folder can be copied, zipped or put in version control (Git works well; add `.vne/` and `exports/` to `.gitignore`).

## Saving

- **Ctrl/⌘+S** saves. The status bar shows *Saved* / *Unsaved changes*.
- Saving writes a new file and then replaces the old one, so a crash during saving never leaves a half-written project.
- The previous version is kept in `.vne/backups/` (the last 10 saves).
- Unsaved work is **autosaved** to `.vne/autosave.json` every few seconds while you edit.

## Recovery

If the editor or computer stops before you saved, opening the project offers to **restore the unsaved changes** from the autosave. If the project file itself is damaged, the newest backup is opened instead and you are told so. If the editor's window crashes, it reloads and offers recovery the same way.

## Undo and redo

Every change is undoable, including module settings and graph edits. A short message tells you what was undone or redone.

## Several projects

Open several projects at once in tabs, or use **File → New window**. Recent projects are listed on the Home screen.

## Opening older or newer projects

Projects from older editor versions are upgraded automatically when opened (the original is kept in the backups after the first save). A project saved by a newer editor is not opened, so it cannot be damaged.
