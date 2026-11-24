# Variables and characters

Open **Variables & characters** in the left rail.

## Variables

Each variable has a name, a type (number, text, true/false or **list**), an initial value and a scope. Click *Edit…* in a variable's menu (or double-click it in *Interactions → Game*) to edit a list's starting items. Below the variables, **Collectibles** lists the project's items (see [Game module](game-module.md)).

| Scope | Lifetime |
| --- | --- |
| **Game** | Saved with each save slot; reset on a new game |
| **Persistent** | Shared by all playthroughs (for example "ending seen"); survives new games |
| **Scene** | Defined on a scene; reset each time the scene starts |

Variables are used in conditions, choice conditions and effects, Event nodes, script blocks, effect graphs (*Variable* node) and dialogue (`{name}`). Renaming a variable updates every use, because uses refer to its id. Deleting one that is in use asks first and lists the uses; remaining references are reported as problems.

## Characters

A character has a name, a color (used for the speaker name), a description and **portraits** — named images. Dialogue lines pick the speaker and portrait; character layers on stage show the portrait of their latest line.

**Character studio** (in an open character) adds a skeleton of image parts, motions and expressions, or imports them from Spine — see [Characters](characters.md). The library button (📚) next to **+** adds a character saved in your library; **Save to library** saves one.

## Reusable behaviors and compositions

See [Interactions](scripting.md#reusable-behaviors) and [Scenes](scenes.md#reusable-compositions).
