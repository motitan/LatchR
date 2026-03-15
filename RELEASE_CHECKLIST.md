# Release checklist

## Before tagging a release

- [ ] `npm run check` passes
- [ ] App launches and core workflows smoke-tested
- [ ] `dist/LatchR.app` launches directly from Finder
- [ ] Project create/open/save validated
- [ ] Timeline edit + event list + label flows validated
- [ ] ffmpeg clip export validated with real source video
- [ ] README updated for user-visible changes
- [ ] License messaging is consistent across `README.md`, `LICENSE`, and `package.json`
- [ ] CHANGELOG/release notes drafted

## Build release artifact

- [ ] `npm run package:mac:zip` completes on macOS
- [ ] Release artifact exists at `release/LatchR-macOS-vX.Y.Z.zip`
- [ ] Zipped app unpacks cleanly into `LatchR-macOS-vX.Y.Z/LatchR.app`
- [ ] Zipped release includes `Open LatchR Project.command`
- [ ] Unzipped app can be moved to `/Applications` and launched by click
- [ ] Bundled `ffmpeg` export works without requiring Homebrew on the target machine
- [ ] Gatekeeper first-open instructions tested on an unsigned build

## GitHub release prep

- [ ] Version bumped in `package.json`
- [ ] Tag created (`vX.Y.Z`)
- [ ] GitHub Release drafted from the tag
- [ ] `LatchR-macOS-vX.Y.Z.zip` uploaded to release assets
- [ ] Release notes include:
  - [ ] New features
  - [ ] Fixes
  - [ ] Known issues
  - [ ] Migration notes (if schema/IPC changed)
  - [ ] macOS install instructions
  - [ ] MIT / open-source license note if needed
  - [ ] unsigned-app / Gatekeeper note
