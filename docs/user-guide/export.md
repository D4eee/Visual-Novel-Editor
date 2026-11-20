# Exporting your game

**Export** (top bar, **Ctrl/⌘+E**) turns the project into a game that runs without the editor.

An exported game contains the game player (`player.js`), the project data (`game.js`), the assets it uses and its runtime modules. The player renders every scene in real time — layers, keyframe animation, particles, video, transitions and WebGL effects — with the same runtime as the editor's preview, so what you see in the preview is what players see. Nothing has to be pre-rendered, and the web, macOS and Windows builds draw identically.

## Settings

| Setting | Notes |
| --- | --- |
| Game title, version, author | Shown in the window title, the title screen and the app's metadata |
| Bundle identifier | Reverse-DNS id (`com.studio.mygame`), used as the app identity on macOS and Windows |
| App icon | A square PNG (1024×1024 is best). Converted to `.icns` (macOS) and `.ico` (Windows) |
| Resolution | The game's internal size; it scales to any window with letterboxing |
| Starts in | A window or fullscreen; window size; whether players may resize or switch to fullscreen |
| Platforms | macOS Apple Silicon, macOS Intel, Windows x64, Web |
| Output folder | Defaults to `exports/` in the project folder |

The **Checks** section runs validation first. Errors (for example a missing asset, a jump without destination, a missing runtime module) block the export and link to the problem. The **Runtime modules** section lists the modules that will be included.

## What you get

| Platform | Output |
| --- | --- |
| macOS | `<Title>-mac-arm64/<Title>.app` (or `-mac-x64`) |
| Windows | `<Title>-win-x64/<Title>.exe` with its files, plus `<Title>-win-x64.zip` to share |
| Web | `<Title>-web/` — upload to any static web host (itch.io, GitHub Pages…) |

Only assets that are used are included, together with the runtime part of the modules in use. Editor data (graph layout, notes, editor-only modules) is stripped. Players' saves and settings are kept separately for each game.

Games are built on Electron. The editor ships with the Electron runtimes it needs; if your build of the editor does not include them, the first export for a platform downloads the official Electron release once and verifies its SHA-256 checksum. Exporting a different platform than the one you are on works (for example, a Windows game from a Mac).

## macOS: signing and Gatekeeper

On a Mac the exported app is signed ad-hoc automatically, which lets it run on your own Mac. To give the game to other people:

- **Without an Apple Developer account**: players right-click the app → **Open** the first time (or run `xattr -cr "/path/to/Game.app"` in Terminal).
- **With an Apple Developer ID**: sign and notarize before distributing:
  ```bash
  codesign --force --deep --options runtime --sign "Developer ID Application: Your Name (TEAMID)" "Game.app"
  ditto -c -k --keepParent "Game.app" Game.zip
  xcrun notarytool submit Game.zip --apple-id you@example.com --team-id TEAMID --wait
  xcrun stapler staple "Game.app"
  ```

If you exported the macOS app on Windows or Linux, run `codesign --force --deep --sign - "Game.app"` on a Mac before first launch.

## Windows: SmartScreen

Unsigned executables show a SmartScreen warning ("More info → Run anyway"). To avoid it, sign `Game.exe` with a code-signing certificate (`signtool sign /fd SHA256 /a Game.exe`).

## Testing the web build

Browsers do not run games from `file://`. Serve the folder, for example `npx serve "<Title>-web"` or `python3 -m http.server` inside it.
