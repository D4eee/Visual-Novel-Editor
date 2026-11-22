# Importing a script

Write the story as plain text — in any editor, on your phone, or by pasting from a document — and import it: the editor creates the scenes, dialogue, choices and connections for you.

Open it from the story graph: the **📄** button in the graph's toolbar, or **Import a script** on an empty chapter. Paste or type on the left (or **Open a text file**); the right side shows what will be made and warns about anything it cannot connect. **Show an example** fills in a short sample.

## The format

```text
# Chapter one                 ← optional: starts a chapter
## Morning                    ← starts a scene
[bg: #2a3350]                 ← background color…
[bg: bg_rooftop]              ← …or a background image, by asset name
[music: bgm_city]             ← background music, by asset name
The alarm rang for the third time.      ← narration
Mia: Five more minutes…                  ← a line said by Mia
Mom (angry): You'll be late again!       ← with Mom's "angry" portrait
[voice: mom_03]               ← the voice of the next line
> Note: narration that contains a colon
* Get up -> Kitchen           ← a choice leading to the scene "Kitchen"
* Stay in bed -> Late

## Kitchen
Mom: Breakfast is ready.
-> END                        ← where the scene goes next; END adds an ending

// a comment
```

- A colon after a short name makes a line of dialogue; Chinese full-width colons and brackets work too: `小美（开心）：早上好！`. Use `>` at the start of narration that contains a colon. `Narrator:` / `旁白：` lines are narration.
- A scene **without choices and without `->`** continues to the next scene of the same chapter.
- Choices and `->` name scenes of the script, or scenes already in the project (in the same chapter). `-> END` (or `结束`) goes to an ending.
- Speakers that are not characters yet are created. Portraits, images, music and voices are matched by name; missing ones are listed after the import, and the lines are still made.
- Lines before the first `##` make a scene without a name.

## After the import

The new scenes are placed below what the chapter already has, connected, and selected in the graph. If the chapter's start node did not lead anywhere, it now leads to the first new scene; a new chapter starts at its first scene. Everything is one step in the history, so ⌘/Ctrl+Z removes the whole import.

The [AI assistant](ai-assistant.md) can import scripts too (its `import_script` tool), so you can ask it to write a branch and add it in one go.
