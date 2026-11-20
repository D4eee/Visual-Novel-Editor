# Assets

Assets are the images, audio, video and fonts of a project. They are copied into the project's `assets/` folder, so the project folder is always self-contained.

## Importing

- Drop files onto the **Assets** panel, or use **Import files**.
- Identical files are recognised by content and never duplicated.
- Drag an asset onto the scene canvas to create a layer: a screen-sized image becomes the background (if the scene has none), other images become image layers, and audio and video become audio and video layers.

Supported: PNG, JPEG, WebP, AVIF, GIF, SVG, BMP · MP3, OGG/Opus, WAV, M4A/AAC, FLAC · MP4 (H.264), WebM, MOV, OGV · TTF, OTF, WOFF, WOFF2. For exported games, prefer PNG/WebP, OGG or M4A, and MP4 (H.264) or WebM.

## Browsing

Filter by kind and search by name or tag. Selecting an asset shows a preview (images, playable audio and video), its size, dimensions or duration, its tags, and **Used in** — every scene, layer, line, character or setting that uses it. Click a use to go there.

## Missing files and relinking

If a file is moved or deleted outside the editor, the asset is marked **File missing**, the Assets button shows a badge, and the Problems list reports each use. Choose **Locate missing file…** to point the asset at the file's new location; every use is fixed at once. **Replace file…** swaps the content of an asset everywhere it is used.

**Remove from project** removes the asset from the project (after telling you where it is used). The file stays on disk.

Only assets that are actually used are included when you export.
