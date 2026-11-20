# Variables and characters

Open **Variables & characters** in the left rail.

## Variables

Each variable has a name, a type (number, text or true/false), an initial value and a scope:

| Scope | Lifetime |
| --- | --- |
| **Game** | Saved with each save slot; reset on a new game |
| **Persistent** | Shared by all playthroughs (for example "ending seen"); survives new games |
| **Scene** | Defined on a scene; reset each time the scene starts |

Variables are used in conditions, choice conditions and effects, Event nodes, script blocks, effect graphs (*Variable* node) and dialogue (`{name}`). Renaming a variable updates every use, because uses refer to its id. Deleting one that is in use asks first and lists the uses; remaining references are reported as problems.

## Characters

A character has a name, a color (used for the speaker name), a description and **portraits** — named expressions, each an image. Dialogue lines pick the speaker and portrait; character layers on stage show the portrait of their latest line.

## Reusable behaviors and compositions

See [Interactions](scripting.md#reusable-behaviors) and [Scenes](scenes.md#reusable-compositions).
