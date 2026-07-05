# LatchR Development Plan — Video Analysis App

This is the working plan for evolving LatchR from a tagging + clip-export tool
into a fuller video-analysis app for sports analysts. It complements
[ROADMAP.md](../ROADMAP.md) (the short public summary); this document is the
engineering-level plan.

## Where the app is today (v0.1.x)

Already working:

- Project packages (`.latchr`) with video, timelines, templates, autosave,
  rolling backups, snapshot/manifest integrity files
- Live and manual tagging from template-driven button canvases, hotkeys,
  pre/post-roll, auto-linked events, XY pitch capture (point + trajectory)
- vis-timeline view with drag/resize editing, multi/single/non-overlap rows,
  row sorting, area selection, period markers with drag re-sync
- Event table with filters, bulk selection, label editing, undo/redo
- Team-aware button/label coloring (jersey overrides, template-derived roles)
- Clip export, merged export, Smart Render stream-copy with safe fallback,
  video conversion with progress + truncation detection
- Template editor with builder (team / grouped / free modes)

Known structural constraints:

- Single 13k-line `index.html` renderer, no bundler, no unit tests
  (`npm run check` is syntax-only)
- macOS-only packaging, unsigned app

## Phase 1 — Hardening (v0.2.x)

Goal: make what exists dependable before adding surface area.

- **Testing**: extract pure logic (event normalization, period math, session
  naming, sync plans) into testable modules loaded by the inline script, add a
  Node test runner (`node --test`) to CI alongside `npm run check`
- **Crash-safe autosave recovery**: on startup, detect newer snapshot/backup
  than canonical timeline and offer restore
- **Error surfacing**: replace `window.confirm/prompt` with in-app dialogs;
  collect ffmpeg failures into a reviewable log panel
- **Performance**: virtualize the event table and batch vis-timeline updates
  for 1,000+ event timelines
- **Schema versioning**: introduce `project_version` migrations
  (currently written but never checked on load)

## Phase 2 — Analysis workflows (v0.3–v0.5)

Goal: move from "tagging and cutting" to "analysis".

- **Playlists / presentations**: ordered collections of clips across
  timelines, with per-clip notes; export as merged video with title cards
- **Drawing / telestration**: pause-frame annotation layer (arrows, zones,
  spotlights) rendered over the video; store per-event; burn-in on export via
  ffmpeg filters
- **Stats view**: counts/durations by tag, label, period, and team; simple
  matrix (rows = tags, columns = labels/periods); pitch-map plots from the
  already-captured XY data; CSV export
- **Import/export adapters**: Hudl Sportscode XML, generic CSV, and the
  existing legacy session format behind one adapter interface
- **Multi-angle**: per-event angle switching for projects with more than one
  synced video (builds on the existing half-sync offset machinery)

## Phase 3 — Team & distribution (v1.0)

- **Template/team presets**: reusable club packs (template + jersey palettes +
  naming library) shareable as files
- **Review mode**: read-only project viewing for coaches (no accidental edits)
- **Signing/notarization** and auto-update feed; evaluate Windows/Linux
  packaging once the renderer is modularized
- **Optional sync**: self-hosted folder sync (e.g. project packages on shared
  storage) before any cloud service

## Engineering guardrails

- Keep IPC contracts and `.latchr` schema stable; new features add channels,
  never repurpose them (see CLAUDE.md)
- All timeline mutations go through the single refresh path
- New renderer code should go into extracted modules, not grow the inline
  script further
- Every phase ships behind the existing verification bar:
  `npm run check`, app launch, end-to-end smoke of the changed workflow
