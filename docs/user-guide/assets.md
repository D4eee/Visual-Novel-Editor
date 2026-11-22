# Assets

Assets are the images, audio, video and fonts of a project. They are copied into the project's `assets/` folder, so the project folder is always self-contained.

## Importing

- Drop files onto the **Assets** panel, or use **Import files**.
- Identical files are recognised by content and never duplicated.
- Drag an asset onto the scene canvas to create a layer: a screen-sized image becomes the background (if the scene has none), other images become image layers, and audio and video become audio and video layers.

Supported: PNG, JPEG, WebP, AVIF, GIF, SVG, BMP · MP3, OGG/Opus, WAV, M4A/AAC, FLAC · MP4 (H.264), WebM, MOV, OGV · TTF, OTF, WOFF, WOFF2. For exported games, prefer PNG/WebP, OGG or M4A, and MP4 (H.264) or WebM.

## Generating images

Draft backgrounds and character sketches with an image service: the **✦ image** button in the Assets panel opens **Generate images**.

1. Set up a service once in *Settings → Image generation*: **OpenAI format** (OpenAI's `gpt-image-1` or `dall-e-3`, or any service with the same API — including proxies that offer Midjourney or Flux), **Stability AI** (Stable Image Core, Ultra, SD 3.5) or **Replicate** (Flux, SDXL and other models; `owner/model` runs its latest version). Paste your API key; it is stored on this computer, encrypted where the system allows, and only sent to that service's address.
2. Choose **Background** (shaped like your stage), **Character sketch** (portrait, full body on a plain background) or **Other**, describe the image, and optionally what to avoid.
3. **Generate** (⌘/Ctrl+Enter) makes 1–4 images. **Add to assets** keeps one; **Use as background** also puts it behind the scene that is open.

Every image is charged by the service you use. Midjourney has no official API; use it through an OpenAI-format proxy that offers it. Generated images are drafts: check their quality and the service's terms before you publish them. The [AI assistant](ai-assistant.md) can generate images too, when you ask it to.

## Browsing

Filter by kind and search by name or tag. Selecting an asset shows a preview (images, playable audio and video), its size, dimensions or duration, its tags, and **Used in** — every scene, layer, line, character or setting that uses it. Click a use to go there.

## Missing files and relinking

If a file is moved or deleted outside the editor, the asset is marked **File missing**, the Assets button shows a badge, and the Problems list reports each use. Choose **Locate missing file…** to point the asset at the file's new location; every use is fixed at once. **Replace file…** swaps the content of an asset everywhere it is used.

**Remove from project** removes the asset from the project (after telling you where it is used). The file stays on disk.

Only assets that are actually used are included when you export.
