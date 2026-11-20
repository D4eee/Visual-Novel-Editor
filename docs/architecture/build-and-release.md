# Build and release

## Requirements

- Node.js 20 or newer, npm.
- macOS builds: a Mac (Xcode command line tools for `codesign`). Windows builds: Windows 10/11 (or macOS/Linux with Wine for the NSIS installer).
- Internet access for `npm install` and for downloading the Electron runtimes once.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Installs the dependencies (build tools and Electron are pinned to exact versions) and creates `package-lock.json` — commit it |
| `npm run build` | Builds everything into `dist/` (editor, player, desktop, server, test bundle) and `sdk/dist/` |
| `npm start` | Build and run the desktop editor |
| `npm run serve` | Build and run the editor in a browser (`http://127.0.0.1:5199`) — used for development and automated UI tests |
| `npm run watch` | Rebuild on change (development) |
| `npm test` | Build and run the automated tests |
| `npm run typecheck` | TypeScript type check |
| `npm run check-i18n` | Report interface strings missing from either language |
| `npm run docs:api` | Regenerate `docs/api/README.md` from the SDK typings |
| `npm run fetch-runtimes` | Download and verify the Electron runtimes used as export templates (`resources/runtime-templates/`) |
| `npm run dist:mac` | Build the macOS editor (`release/*.dmg`, `*.zip`, arm64 + x64) with all export runtimes bundled |
| `npm run dist:win` | Build the Windows editor (`release/*Setup*.exe`, `*.zip`) with all export runtimes bundled |
| `npm run pack-module -- <folder>` | Package a module as `.vnemod` |

## Reproducibility

- Build tools (esbuild, TypeScript, React) and Electron are pinned to exact versions in `package.json`; commit the `package-lock.json` created by the first `npm install` and use `npm ci` afterwards. The Electron version (`45.4.1`) is the same one used for exported games (`packages/host/src/templates.ts`).
- Export runtime templates are the official Electron release zips, verified against Electron's published `SHASUMS256.txt` both by `fetch-runtime-templates.mjs` and by the editor when it downloads on demand.
- The build uses esbuild with fixed targets; no network access during the build itself.
- Example game assets are generated from code (`examples/games/_sources/like-human/make.mjs`: SVG → PNG with `rsvg-convert`, audio with NumPy + FFmpeg) and committed, so builds do not depend on those tools.

## Signing and notarization

The editor build is unsigned by default. To sign:

- **macOS:** set `CSC_LINK`/`CSC_KEY_PASSWORD` (Developer ID certificate) and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization, then `npm run dist:mac` (electron-builder signs and notarizes).
- **Windows:** set `CSC_LINK`/`CSC_KEY_PASSWORD` for an Authenticode certificate.

Exported games are signed separately (see the user guide's [export page](../user-guide/export.md)).

## Release checklist

1. `npm ci` (or `npm install` the first time), `npm test`, `npm run check-i18n`
2. `npm run dist:mac` on a Mac, `npm run dist:win` on Windows.
3. Smoke test each build: create a project from the example, preview it, export macOS/Windows/Web and launch the exported games.
4. Tag the release and attach the artifacts.
