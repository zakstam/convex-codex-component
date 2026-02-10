# @convex-dev/codex-local-component

## 0.2.0

### Minor Changes

- ce21324: Refactor sync APIs and consumer helpers for clearer ingest/replay semantics.

  ### Highlights
  - Rename sync component APIs to `ingest`, `replay`, `resumeReplay`, `listCheckpoints`, `upsertCheckpoint`
  - Rename client helpers to `replayStreams` and `resumeStreamReplay`
  - Add typed `@zakstam/codex-local-component/app-server` entrypoint
  - Improve stream replay metadata (`streamWindows`, `nextCheckpoints`)
  - Add keyset pagination baseline for durable message listing
  - Add Tauri end-to-end example app and update integration docs

## 0.1.3

### Patch Changes

- 5d00d46: Fix Node ESM compatibility for protocol and bridge imports by adding JSON import attributes in the protocol parser and using an explicit `./v2/index.js` export path in protocol schemas.

## 0.1.2

### Patch Changes

- 0966382: Migrate package scope from `@convex-dev/codex-local-component` to `@zakstam/codex-local-component` and update all consumer imports, docs, and release smoke checks.

  Add explicit npm publish configuration for public scoped publishing.

## 0.1.1

### Patch Changes

- 1638598: Fix package release integrity by including required generated component files, resolving strict TypeScript status-priority typing in message mapping, and using a CI-safe test glob in package test scripts.
- 806e57f: Initial release of `@convex-dev/codex-local-component` with local Codex bridge,
  Convex component APIs, typed client/react helpers, and release smoke host coverage.
