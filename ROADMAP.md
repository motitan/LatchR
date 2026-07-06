# Roadmap

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for the detailed
engineering plan. Short version:

## Now (v0.x hardening)

- Stabilize project create/save/open flows
- Automated tests for core logic (events, periods, sync plans)
- Autosave recovery on startup
- Better error messages for import/export failures
- Performance for large timelines (1,000+ events)
- Schema versioning and migration for `.latchr.json`

## Next (analysis workflows)

- Playlists / presentations built from tagged clips
- Drawing & telestration on paused frames (burned into exports)
- Stats view: counts/durations by tag, label, period, team + pitch maps
- Import/export adapters (Hudl Sportscode XML, CSV)
- Multi-angle projects with per-event angle switching

## Later (v1.0 and beyond)

- Shareable club packs (template + team colors + naming library)
- Read-only review mode for coaches
- Signing/notarization and auto-update
- Optional sync (self-hosted first)

## Contributions wanted

- Testing infrastructure
- Performance optimization for large timelines
- Documentation and tutorials
- UI/UX refinements for analyst workflows
