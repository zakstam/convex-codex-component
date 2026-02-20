"@zakstam/codex-local-component": minor
---

Unify public thread identity contracts on `threadHandle` across host/component boundaries.

- `threads.list` now returns `threadHandle` in page rows.
- Runtime-owned host endpoints now accept `threadHandle` for thread-targeted reads/mutations (for example `threadSnapshot`, `listThreadMessages`, `listTurnMessages`, `listThreadReasoning`, `listPendingServerRequests`, `deleteThread`, `scheduleDeleteThread`, `deleteTurn`, `scheduleDeleteTurn`, `respondApproval`, and `interruptTurn`).
- Added a package contract test that enforces thread-handle consistency across create/list/send/delete flows.
