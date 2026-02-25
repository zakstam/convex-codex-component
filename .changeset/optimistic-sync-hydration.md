---
"@zakstam/codex-runtime": minor
---

Add first-class sync-hydration optimistic UI support for runtime-owned conversation flows.

- Add `syncHydrationSource` support to `CodexProvider` and `useCodex` wiring.
- Merge local unsynced snapshot messages into `useCodex(...).messages.results` while preserving durable reconciliation.
- Expose per-message sync metadata (`syncMetaByMessageId`) and conversation-level hydration state (`syncHydrationState`).
- Extend Tauri bridge client with `syncHydration` snapshot subscription helpers for fast unsynced conversation rendering.
- Update docs and examples to show syncing/failed badges for local snapshot messages during import/sync.
- Harden large local-thread imports with adaptive ingest chunk splitting when Convex document-read limits reject a batch.
