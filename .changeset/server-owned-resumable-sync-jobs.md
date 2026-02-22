---
"@zakstam/codex-local-component": minor
---

Introduce server-owned resumable conversation sync jobs with durable job/chunk staging, internal chunk workers, and explicit sync-job host APIs (`startConversationSyncJob`, `appendConversationSyncChunk`, `sealConversationSyncJobSource`, `cancelConversationSyncJob`, `getConversationSyncJob`, `listConversationSyncJobs`).

`importLocalThreadToPersistence(...)` now orchestrates through durable sync jobs instead of direct helper-owned ingest loops, and sync hydration metadata now includes `syncJobState` and `lastCursor` for stronger stale-event gating and deterministic send blocking during active sync.

Runtime `listThreads(...)` now returns a canonical typed shape with required normalized `messageCount` (`{ data: Array<{ threadId, preview, updatedAt, messageCount }>, nextCursor }`) so helper/host consumers no longer rely on ad-hoc field probing.

Sync jobs now fail closed on completion via canonical message manifest verification (`expectedMessageCount` + `expectedMessageIdsJson`), and terminal `synced` is only written when all expected canonical message IDs are durably present.
