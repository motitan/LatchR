# Architecture

## High level

LatchR is an Electron desktop app with:

- Main process (`main.js`) for filesystem, ffmpeg, IPC handlers
- Renderer (`index.html`) for UI and interaction logic
- Preload bridge (`preload.js`) exposing safe API surface

## Canonical files

- `main.js`
- `preload.js`
- `index.html`
- `styles.css` (legacy)

Historical prototypes are kept under `legacy/` and are not runtime entrypoints.

## Data model

Core event shape in renderer:

```js
{
  id,
  name,
  start,
  end,
  color: [r, g, b],
  labels: [{ text, group }],
  period
}
```

## Project package

Projects are stored as a macOS document package (`.latchr`) that contains
the project JSON plus `video/`, `timelines/`, and `tag_templates/`.

The main project file (`.latchr.json`) includes:

- project name
- video/template/timeline paths
- current events

Do not change schema without migration logic.

## Path policy

- Use `os.homedir()` in `main.js`
- Use `path.join()` for all path construction
- Keep file creation/move/copy in main process only

## IPC guidance

- Keep channel signatures stable unless migration task is explicit
- Return structured errors to renderer (`{ ok:false, error }`)
- Never allow renderer direct unrestricted filesystem access

## Timeline update rule

Keep timeline rendering centralized and avoid ad-hoc mutations from many handlers.
Use one refresh path to reduce UI desync bugs.
