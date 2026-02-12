---
"@zakstam/codex-local-component": minor
---

Add async cascade deletion APIs for Codex persisted data with job-based status tracking.

New public component endpoints:
- `threads.deleteCascade`
- `threads.scheduleDeleteCascade`
- `turns.deleteCascade`
- `turns.scheduleDeleteCascade`
- `threads.purgeActorData`
- `threads.schedulePurgeActorData`
- `threads.cancelScheduledDeletion`
- `threads.forceRunScheduledDeletion`
- `threads.getDeletionJobStatus`

Add matching typed client helpers:
- `deleteThreadCascade`
- `scheduleThreadDeleteCascade`
- `deleteTurnCascade`
- `scheduleTurnDeleteCascade`
- `purgeActorCodexData`
- `schedulePurgeActorCodexData`
- `cancelScheduledDeletion`
- `forceRunScheduledDeletion`
- `getDeletionJobStatus`

Deletion runs in paged internal jobs and reports scheduled/queued/running/completed/failed/cancelled states.
