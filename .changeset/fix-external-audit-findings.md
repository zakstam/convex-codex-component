---
"@zakstam/codex-local-component": minor
---

Improve host integration surface based on external API audit.

- Add `lastEventCursor` arg to `ensureSession` preset mutation (was silently hardcoded to 0).
- Rename `ensureThread` preset arg from `threadId` to `localThreadId` to match `HostRuntimePersistence` interface.
- Export `isTurnNotFound` error classifier from `./host/convex`.
- Re-export `upsertTokenUsageForActor`, `listTokenUsageForHooksForActor`, `hasRecoverableIngestErrors` from `./host/convex`.
- Export `vManagedServerRequestMethod` and `vServerRequestId` validators from `./host/convex`.
