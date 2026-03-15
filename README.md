# LatchR

Open-source desktop video tagging for sports analysis.

LatchR is built for non-technical analysts who want a clickable macOS app, and
for technical contributors who want to extend or improve the tooling behind it.

LatchR is released under the MIT license. That means the code can be used,
modified, redistributed, and used commercially under the terms in
[LICENSE](./LICENSE).

This is an early public release: the core trimming and export workflow is already
useful, but the app is still evolving and has not been broadly validated across
many different machines and workflows yet.

Support the project:
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-motitan-FFDD00?logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/motitan)

## For macOS users

LatchR is a desktop app for tagging match video, editing event timelines, and
exporting clips without running a browser server or developer commands.

The packaged macOS release already includes:

- the Electron runtime
- local `vis-timeline` assets
- bundled `ffmpeg` / `ffprobe`

End users do not need Node.js, Homebrew, or an internet connection after the
download finishes.

### Download and install

1. Open the latest GitHub Release.
2. Download `LatchR-macOS-vX.Y.Z.zip`.
3. Unzip the file.
4. Open the extracted `LatchR-macOS-vX.Y.Z` folder.
5. Drag `LatchR.app` to `/Applications`.
6. Open `LatchR.app` from Finder, Launchpad, or the Dock.

The release zip also includes `Open LatchR Project.command` as a fallback opener
for project packages if Finder association is not behaving yet.

Because the app is not signed or notarized, macOS may block the first launch:

- Right click `LatchR.app` and choose `Open`, then confirm.
- Or allow it in `System Settings > Privacy & Security`.

### What LatchR does

- Video playback with timeline sync
- Fast live/manual tagging
- Timeline drag/resize with 0.1s precision
- Event list filtering, bulk selection, and label editing
- Template-driven tagging workflows
- Clip export to MP4 with `ffmpeg`
- Merged MP4 export
- Smart Render export mode with safe fallback
- Project save/open plus autosave

### Project files and backups

Projects are stored as `.latchr` packages, which macOS treats like document
packages instead of plain folders.

Each project package contains:

- the main `.latchr.json` project file
- `video/`
- `timelines/`
- `tag_templates/`

Workspace data is stored under:

- `~/LatchR/projects/<project_name>.latchr/`
- `~/LatchR/tag_templates/`
- `~/Desktop/video_prototype/` for clip export output

Timeline writes create safer companion files:

- `<timeline>.json` as the canonical timeline
- `<timeline>.snapshot.json` as the last known-good snapshot
- `<timeline>.manifest.json` as integrity and summary metadata
- `<timeline>.bak.1.json` ... `.bak.3.json` as rolling backups

The UI timeline selector only shows canonical `<timeline>.json` files.

### Current limitations

- macOS is the primary packaged platform today.
- The app is unsigned, so first launch needs the Gatekeeper workaround above.
- This is an early public release, so workflows and edge cases will still improve over time.

## For contributors

LatchR is an Electron app with:

- `main.js` for filesystem access, `ffmpeg`, and IPC handlers
- `preload.js` for the context bridge API
- `index.html` for renderer UI and interaction logic
- `styles.css` as a legacy stylesheet
- `legacy/` for historical prototypes that are not runtime entrypoints

Project schema and IPC contracts should be treated carefully:

- Keep filesystem operations in `main.js`.
- Use `path.join()` for path construction.
- Do not change project schema or IPC contracts without migration work.
- Return structured errors from main process handlers.

### Development quick start

Requirements for running from source:

- macOS (primary tested platform currently)
- Node.js 20+
- `ffmpeg` available in `PATH`

Install `ffmpeg` for local development on macOS:

```bash
brew install ffmpeg
```

Run from source:

```bash
git clone <your-repo-url>
cd latchr
npm install
npm run check
npm start
```

`npm start` is for local development only. End users should use the packaged
GitHub Release instead.

### Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [ROADMAP.md](./ROADMAP.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/RELEASING.md](./docs/RELEASING.md)
- [LICENSE](./LICENSE)

### CI

Minimal CI is configured in:

- `.github/workflows/ci.yml`

It runs:

```bash
npm ci
npm run check
```

## License

LatchR is MIT-licensed open-source software.

- Commercial use is allowed.
- Modification and redistribution are allowed.
- The license notice and disclaimer must stay with substantial copies of the software.

See [LICENSE](./LICENSE) for the exact terms.

## Safety and legal notes

- Do not commit copyrighted match videos to this repository.
- Prefer sharing small synthetic/demo assets or metadata-only examples.
- Use clips/video exports according to rights and competition agreements.
