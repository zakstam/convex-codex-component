# Changesets

Use Changesets to record releasable changes for `@zakstam/codex-local-component`.

## Add a changeset in a PR

From repo root:

```bash
pnpm changeset
```

Then:

1. Select `@zakstam/codex-local-component`.
2. Choose version bump type (`patch`, `minor`, or `major`).
3. Write a concise human-readable summary of the change.
4. Commit the generated `.changeset/*.md` file with your PR.

## Release flow

1. PRs with changesets merge into `main`.
2. GitHub Actions opens/updates a "Version Packages" PR.
3. That PR auto-merges when required checks pass.
4. Merge to `main` triggers automated npm publish to `latest`.
