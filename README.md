# ClarityX Player (Desktop App Only)

ClarityX is a **Windows desktop video player** built with Electron.

This repository is for the **app version only** (not web hosting/deployment).

## What users get

- Anime4K real-time upscaling shader (`anime4k.js`) built into the app
- Local file playback with resume memory
- YouTube/direct URL streaming through bundled `yt-dlp.exe`
- Format selection that prioritizes streams with audio
- Custom app icon for the EXE and app window

## Quick start (for users)

1. Download the latest Windows build from **Releases**.
2. Open the extracted folder.
3. Run `ClarityX Player.exe`.

No terminal is needed for normal use.

## Build app from source (Windows)

Requirements:

- Node.js 18+
- npm

Commands:

```bash
npm install
npm run electron:build
```

Output:

- Desktop app files are generated in `dist-app/win-unpacked/`

Run locally (desktop app mode):

```bash
npm run build
npm run electron:start
```

## Notes

- This app includes `yt-dlp.exe` for URL extraction.
- Anime4K shader file is loaded via `public/anime4k.js` and bundled into `dist/anime4k.js`.
- If Windows build fails with symlink permission errors, enable Windows Developer Mode or run terminal as Administrator.
