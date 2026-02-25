---
"@zakstam/codex-runtime": patch
---

Fixes several edge-case correctness issues in runtime-owned host integration:

- Fail closed for stale `markConversationSyncProgress` updates when `expectedSyncJobId` does not match the binding job id (including missing current job id).
- Clear stale `syncJobErrorCode` on healthy sync progress updates when no replacement error code is provided.
- Tighten managed tool `requestUserInput` question validation so malformed `options` entries are rejected.
- Reclassify `getConversationSyncJob` and `listConversationSyncJobs` as query endpoints in the host surface and example host shims.
