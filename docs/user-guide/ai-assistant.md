# AI assistant

The AI assistant works on your project with you: ask it to write scenes, add elements and animations, build interactions or check your story, and it makes the changes in the editor while you watch. Every change can be undone.

Open it with the **✦ AI** button next to the **+** in the tab bar (⌘/Ctrl+J). It slides in from the right; drag its left edge to make it wider.

## Connect a model

The assistant uses a language model through **your own API key** (*Settings → AI assistant*):

- **Claude (Anthropic)** — paste an Anthropic API key and pick a model (for example `claude-sonnet-5-5`).
- **OpenAI-compatible** — any service with an OpenAI-style Chat Completions API: OpenAI, DeepSeek, Kimi (Moonshot), Qwen (DashScope), Zhipu GLM, OpenRouter, a local **Ollama**, or a custom address. Pick the service, paste its key and choose a model. To change the project, the model needs **tool (function) calling**.

Press **Test connection** to check it. Under *Advanced* you can change the API address (for a proxy or gateway) and the longest reply.

Your key is stored on this computer only — encrypted with the system keychain in the desktop app — and is sent only to the service it was saved for: each service address keeps its own key. Your messages and the parts of the project the assistant reads are sent to that service.

## Talking to it

- Type and press **Enter** (Shift+Enter for a new line). **Stop** ends a reply early.
- The assistant sees what you have open and selected: "this scene", "the selected element".
- Each action it takes shows as a line (✓ done, ⚠ error — it then corrects itself). Click a line to see the details.
- After a reply that changed the project, **Undo this reply** puts the project back as it was before the reply (itself undoable). Each single change is also in the normal undo history, labelled *AI · …*.
- **+** starts a new conversation. Each open project has its own conversation.
- **📷** next to the message box attaches a picture of the open scene's canvas, so a model that understands images can see the layout ("why does this look crowded?"). The assistant can also look by itself with its *view scene* tool, for example to check its own changes. Use a model with image input (Claude, GPT-4o and similar).

The badge in the panel header switches between **Can edit** and **Read-only**: read-only, the assistant reads your project and answers, but does not change it.

## What it can do (editor tools)

The assistant works through the editor's tools, described in the Model Context Protocol (MCP) tool format — the list is under *Settings → AI assistant → Editor tools*:

| Area | Tools |
| --- | --- |
| Reading | project overview, one scene in detail, a picture of a scene, element types and their properties, interaction blocks |
| Story | create / edit / delete scenes and other nodes, connect nodes, chapters, [import a whole script](script-import.md) |
| Characters & variables | add characters, create or change variables |
| Scene content | dialogue lines (add, edit, delete), choices (and where they lead), elements (add, change, delete), parent links |
| Animation | keyframes on any animatable property, animation presets |
| Looks | built-in looks for text, shapes, buttons and free dialogue; picture effects |
| Interactions | scripts made of blocks (trigger + actions) |
| Project | title, resolution, text speed, text box style |
| Images | generate a background or character sketch with the service from *Settings → Image generation* (only when you ask: images cost money) |
| Navigation | open a scene or select an element for you to see |

It asks before deleting things unless you clearly asked for it.
