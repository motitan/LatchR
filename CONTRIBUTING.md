# Contributing

Thanks for contributing to LatchR.

## Ground rules

- Keep changes focused and reviewable.
- Do not break existing project schema or IPC contracts without explicit migration work.
- Keep filesystem operations in `main.js` (renderer should pass strings only).
- Prefer `path.join()` for path construction.

## Contribution license

LatchR is MIT-licensed.

By submitting a contribution, you agree that your contribution is provided under
the same MIT license as the rest of the project, and that you have the right to
submit that code, documentation, or asset.

## Local setup

```bash
npm install
npm run check
npm start
```

## Branch and PR flow

1. Create a branch from `main`.
2. Make a small, focused change.
3. Run `npm run check`.
4. Open a pull request using the PR template.
5. Link issue(s) and describe behavior changes with screenshots if UI changes.

## Commit style

Use clear commit messages:

- `feat: ...` for new functionality
- `fix: ...` for bug fixes
- `docs: ...` for documentation
- `refactor: ...` for non-behavioral code changes

## Testing expectations

Before submitting:

- Verify app starts: `npm start`
- Verify no syntax errors: `npm run check`
- Smoke-test the changed workflow end-to-end

## Areas where help is most useful

- Timeline interaction UX and performance
- Import/export compatibility (Hudl/Sportscode/Botonera variants)
- ffmpeg export reliability and diagnostics
- Automated tests and CI hardening
- Cross-platform packaging and installers
