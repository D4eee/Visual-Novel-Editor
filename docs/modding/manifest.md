# Manifest, packaging and distribution

## module.json

```json
{
  "id": "com.example.relationships",
  "name": { "en": "Relationships", "zh-CN": "好感度系统" },
  "version": "1.0.0",
  "description": { "en": "…", "zh-CN": "…" },
  "author": { "name": "Your Name", "url": "https://example.com" },
  "license": "MIT",
  "homepage": "https://example.com/relationships",
  "engine": ">=0.1.0 <1.0.0",
  "api": "^1.0.0",
  "kind": "combined",
  "runtime": "runtime.js",
  "editor": "editor.js",
  "locales": "locales",
  "dependencies": { "com.example.extra-blocks": "^1.0.0" },
  "provides": { "systems": ["affection"], "blocks": ["change"], "nodes": ["branch"], "components": ["onEnter"], "panels": ["panel"] },
  "permissions": []
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Reverse-domain id such as `com.you.thing` (lowercase recommended; ids starting with `core` are reserved). Permanent: projects reference your types as `<id>/<local id>` |
| `name`, `description` | `name` | Text or `{ locale: text }` |
| `version` | yes | Semantic version of your module |
| `engine` | yes | Editor/engine versions you support, as a semver range |
| `api` | recommended | SDK API versions you support (`^1.0.0`) |
| `kind` | no | `runtime`, `editor` or `combined` (derived from the entries if omitted) |
| `runtime`, `editor` | one of them | Entry files (ES modules) |
| `locales` | no | Folder with `<locale>.json` dictionaries (`en.json`, `zh-CN.json`…) |
| `dependencies` | no | Other modules and version ranges; they load first |
| `provides` | recommended | What you register: `nodes`, `portTypes`, `layers`, `properties`, `interpolators`, `effects`, `transitions`, `blocks`, `components`, `systems`, `panels`, `inspectors`, `nodeWorkspaces`, `workspaces`, `toolbar`, `importers`, `exporters`. Shown in the module manager and used to tell users which module a missing type belongs to |
| `permissions` | no | `storage` (enables `api.storage`). Others are reserved |
| `assets`, `icon` | no | A folder of files you use with `api.assetUrl()`; an icon for the module manager |

The module manager refuses manifests that are invalid, and marks modules whose `engine`/`api` ranges do not match as incompatible (they are not loaded, and their project data is kept).

## Packaging

```bash
npm run pack-module -- path/to/my-module [--out folder]
```

produces `<id>-<version>.vnemod` — a zip with `module.json` at its root. The packer validates the manifest, the entry files and every locale file first. Hidden files and `node_modules` are skipped.

## Installing

**Module manager → Install from file or folder…** accepts `.vnemod`, `.zip` or a folder. Modules are installed into the project (`<project>/modules/<id>/`), so projects stay self-contained when shared. The editor's module library (and bundled examples) can be added to any project with **Use in this project**. No account or network connection is involved.

## Versioning

- Bump `version` for every release. When two versions are available, the project's copy wins, then the newest library copy.
- Keep ids, port ids and data fields backwards compatible; see [compatibility.md](compatibility.md).
- The engine follows semantic versioning for the module API (`api`): additions in minor versions, breaking changes only in a new major version.
