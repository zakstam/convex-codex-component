---
"@zakstam/codex-local-component": minor
---

Promote deletion lifecycle operations to first-class runtime-owned host endpoints exposed through `createCodexHost(...)` (`codex.defs` and `codex.endpoints`).

Added host lifecycle APIs:
- `deleteThread`, `scheduleDeleteThread`
- `deleteTurn`, `scheduleDeleteTurn`
- `purgeActorData`, `schedulePurgeActorData`
- `cancelDeletion`, `forceRunDeletion`
- `getDeletionStatus`

This removes the need for consumers to hand-write actor-binding wrappers for these operations in app-owned `convex/chat.ts` files.
