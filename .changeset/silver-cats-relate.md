---
"@zakstam/codex-local-component": minor
---

Introduce explicit runtime-vs-persisted thread identity and durable sync mapping lifecycle support.

### Added
- New runtime-owned host mutations for sync lifecycle:
  - `syncOpenThreadBinding`
  - `markThreadSyncProgress`
  - `forceRebindThreadSync`
- Durable sync metadata on thread bindings (`syncState`, `lastSyncedCursor`, session/rebind/error markers).
- Explicit lifecycle state fields for bridge/runtime consumers:
  - `persistedThreadId`
  - `runtimeThreadId`

### Changed
- Convex persistence adapter now drives sync-on-open and sync progress watermark updates through the new host mutations.
- Tauri bridge/helper state payloads now expose explicit persisted/runtime thread IDs in addition to existing compatibility fields.

### Docs
- Updated integration and API reference docs for sync mapping endpoints and identity semantics.
