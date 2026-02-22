---
"@zakstam/codex-local-component": minor
---

Redesign durable conversation sync to use immutable import sources and server-owned verified sync jobs.

### What changed

- Replaced mutable sync job staging endpoints with source-first endpoints:
  - `startConversationSyncSource`
  - `appendConversationSyncSourceChunk`
  - `sealConversationSyncSource`
- Added fail-closed source invariant checks at seal time:
  - contiguous chunk indices
  - checksum validation
  - strict expected manifest shape validation
- Updated sync job worker to process sealed immutable source chunks and perform strict terminal verification.
- Updated runtime/host adapters, surface definitions, tests, and docs to the new source lifecycle.

### Behavior impact

- Sync imports now require `expectedManifestJson` and `expectedChecksum` at seal time.
- Conflicting chunk rewrites for the same source chunk index now fail closed.
- Terminal sync success remains reported as `synced`; terminal failures remain `failed|cancelled`.
