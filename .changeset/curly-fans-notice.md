---
"@zakstam/codex-local-component": minor
---

Refactor sync APIs and consumer helpers for clearer ingest/replay semantics.

### Highlights

- Rename sync component APIs to `ingest`, `replay`, `resumeReplay`, `listCheckpoints`, `upsertCheckpoint`
- Rename client helpers to `replayStreams` and `resumeStreamReplay`
- Add typed `@zakstam/codex-local-component/app-server` entrypoint
- Improve stream replay metadata (`streamWindows`, `nextCheckpoints`)
- Add keyset pagination baseline for durable message listing
- Add Tauri end-to-end example app and update integration docs
