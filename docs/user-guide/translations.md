# Translations

One project can ship in several languages. You write the story once, in its own language; the translation table holds the other languages. Players choose a language in the game's **Settings**, and every text they read switches: dialogue, choices, character names, text elements, speech bubbles, labels shown by scripts, and the game's title.

## Set up

1. Click **文A Translations** in the top bar.
2. Choose the language the story is **written in**, and the languages to **translate into**.
3. Click **Set up translations**.

You can add more languages later with **+ Add language**. The **⋯** menu changes the original language or removes a language (undoable).

## The translation table

Each row is one text: where it is (the scene and element, speaker or block; click the scene to open it), the original, and the translation. Type in the right column; the change is saved when you leave the field (⌘/Ctrl+Enter also commits).

| Filter | Shows |
| --- | --- |
| **All texts** | Everything players read |
| **Not translated** | Texts without a translation (players see the original) |
| **Changed** | The original was edited after it was translated: check the translation and edit it to mark it up to date |
| **Translated** | Texts with an up-to-date translation |

Each language button shows how much is done. Search looks in the original, the translation, scene names and speakers.

## Translate with AI

**Translate N with AI** sends the texts that are not translated or have changed to the model set up for the [AI assistant](ai-assistant.md), 30 at a time, with the speaker and scene for context. Variables like `{name}` and tags stay as they are, and character names you have already translated are used consistently. You can stop at any time; translated batches are kept. Review the result before you publish.

## Spreadsheets (CSV)

**CSV** downloads the current language as a spreadsheet: `key`, `where`, `source` and a column for the language. Fill in the last column in Excel, Numbers or Google Sheets, save as CSV (UTF-8), and **Import** it back. Rows are matched by key, so you can sort and filter the sheet freely.

## Preview a language

The **▾** next to **Preview** lists the story's languages under *Preview language*. The preview then plays in that language, with menus in that language when the game's menus exist for it (English and Chinese).

## What players get

- The game starts in the language they chose before or, the first time, the best match for their system language.
- **Settings → Language** lists the story's languages by their own names. A new language shows from the next line on.
- Texts without a translation appear in the original language.
