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
2. Push to `main` runs all release checks, then `pnpm run version-packages`.
3. If changesets are present, the same workflow runs `pnpm run release:publish`.
4. The workflow commits and pushes the generated release files/changelog updates as `chore: version packages`.
5. The workflow does not create a release PR path anymore.
