---
"@zakstam/codex-local-component": patch
---

Unify terminal turn artifact reconciliation behind a single internal mutation path and make activity authority terminal-boundary decisions timestamp-aware (`completedAt/updatedAt` before `createdAt`).

Also update `threadSnapshotSafe` contract/docs to include terminal-aware timestamp invariants used by activity hooks.
