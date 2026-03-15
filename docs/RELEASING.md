# Releasing LatchR on GitHub

This project currently ships macOS releases as a zipped `LatchR.app`.

The packaged app already includes:

- the Electron runtime
- local `vis-timeline` assets
- bundled `ffmpeg` / `ffprobe`

## Release scope

- Public GitHub repository
- Manual GitHub Releases
- macOS only for packaged binaries
- MIT-licensed open-source project
- No DMG yet
- No Apple signing/notarization yet

## Suggested GitHub repo metadata

Use these values when creating the GitHub repository:

- Repository name: `LatchR`
- Description: `Open-source desktop video tagging for sports analysis on macOS.`
- Website: `https://buymeacoffee.com/motitan` if you want the repo website field to point to the support page

The README already includes a Buy Me a Coffee badge for visitors who land on the
repository homepage.

## Prerequisites

- macOS
- Node.js 20+
- `npm install` already run

## Build the release artifact

From the project root:

```bash
npm run check
npm run package:mac:zip
```

This produces:

- `dist/LatchR.app`
- `release/LatchR-macOS-v<version>.zip`

The zip now extracts to:

- `LatchR-macOS-v<version>/LatchR.app`
- `LatchR-macOS-v<version>/Open LatchR Project.command`

## Local verification

Before publishing a release:

1. Open `dist/LatchR.app` directly from Finder.
2. Smoke-test the main workflows you want in the release.
3. Unzip `release/LatchR-macOS-v<version>.zip`.
4. Open the extracted `LatchR-macOS-v<version>/` folder.
5. Move `LatchR.app` to `/Applications`.
6. Launch it by click from Finder, Launchpad, or the Dock.
7. Verify clip export still works on a clean machine without requiring Homebrew.
8. Verify the first-open Gatekeeper workaround instructions still match the real unsigned-app behavior.

## Publish on GitHub

1. Bump `package.json` to the release version.
2. Commit the release changes.
3. Create and push a tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

4. Draft a GitHub Release from that tag.
5. Upload `release/LatchR-macOS-vX.Y.Z.zip` as the release asset.
6. Include release notes covering:
   - new features
   - fixes
   - known issues
   - migration notes if needed
   - macOS install steps
   - MIT / open-source license note if release messaging changed
   - unsigned-app / Gatekeeper note

## End-user install steps

These are the steps non-technical macOS users should follow:

1. Download `LatchR-macOS-vX.Y.Z.zip` from GitHub Releases.
2. Unzip the file.
3. Open the extracted `LatchR-macOS-vX.Y.Z` folder.
4. Drag `LatchR.app` to `/Applications`.
5. Open `LatchR.app` by click.

If opening a project package directly from Finder does not behave yet, users can
run `Open LatchR Project.command` from the extracted release folder as a fallback.

If macOS blocks the first launch because the app is unsigned:

- Right click the app and choose `Open`, then confirm.
- Or open `System Settings > Privacy & Security` and allow the app there.
