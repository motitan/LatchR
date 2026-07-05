# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LatchR is an Electron desktop app for sports video tagging: video playback synced to a vis-timeline, live/manual event tagging, and clip export via ffmpeg. macOS is the primary packaged platform. Requires Node.js 20+ and `ffmpeg` in PATH (`brew install ffmpeg`) for local development.

## Commands

```bash
npm install
npm run check        # syntax/JSON validation of main.js, preload.js, index.html inline script — this is CI; there are no unit tests
npm start            # run the app locally (electron .)
npm run package:mac      # build dist/LatchR.app (bundles Electron, vis-timeline, ffmpeg/ffprobe)
npm run package:mac:zip  # also produce release/LatchR-macOS-v<version>.zip
```

## Architecture

Three canonical runtime files — there is no bundler or framework:

- `main.js` (~3900 lines) — main process. ALL filesystem access, ffmpeg/ffprobe invocation, dialogs, and IPC handlers live here. ffmpeg is resolved from a candidate list (bundled `bin/ffmpeg`, `~/LatchR/bin`, Homebrew paths, PATH).
- `preload.js` — context bridge exposing the whole API as `window.latchrAPI` (plus legacy alias `sportTaggerAPI`).
- `index.html` (~13500 lines) — the entire renderer: UI markup, CSS, and all interaction logic in one inline `<script>` block. `npm run check` parses this inline script, so it must remain a single valid script block.

Not runtime code: `styles.css` (legacy stylesheet), `legacy/` (historical prototypes), `server.py` (older browser-based server mode), `Launch LatchR.command` (end-user launcher fallback).

### IPC conventions

- Handlers are registered via `registerIpcHandler()` in `main.js`, which registers each channel under both `latchr:*` and legacy `sport-tagger:*` names. Keep both when adding channels.
- Channel signatures are contracts: do not change them, or the `.latchr` project schema, without explicit migration work.
- Handlers return structured results (`{ ok: false, error }` on failure), never throw raw errors to the renderer.
- The renderer passes strings/plain data only; it must never get direct filesystem access.
- Use `path.join()` for all path construction; `os.homedir()` for user paths.

### Data model

Projects are `.latchr` macOS document packages under `~/LatchR/projects/`, containing the main `.latchr.json` file plus `video/`, `timelines/`, and `tag_templates/`. Timeline writes produce companion files: canonical `<name>.json`, `.snapshot.json` (last known-good), `.manifest.json` (integrity metadata), and rolling `.bak.1-3.json` backups. Only canonical `<timeline>.json` files appear in the UI selector.

Core event shape in the renderer: `{ id, name, start, end, color: [r,g,b], labels: [{ text, group }], period }`.

### Timeline rendering rule

Keep timeline rendering centralized — route updates through the single refresh path rather than mutating the timeline ad-hoc from individual handlers (this is the main source of UI desync bugs).

## Verification expectations

Before submitting: `npm run check` passes, `npm start` launches, and the changed workflow is smoke-tested end-to-end. Commit style: `feat:` / `fix:` / `docs:` / `refactor:`.

## Releasing

See `docs/RELEASING.md`. Short version: bump `package.json` version, `npm run check && npm run package:mac:zip`, tag `vX.Y.Z`, upload the zip to a GitHub Release. The app is unsigned (no notarization), so release notes must keep the Gatekeeper first-launch workaround.
