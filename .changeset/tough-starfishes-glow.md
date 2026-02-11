---
"@zakstam/codex-local-component": minor
---

Add a first-class host dispatch queue contract with atomic claim + lease semantics for deterministic turn execution ownership.

- Add `dispatch` component APIs: `enqueueTurnDispatch`, `claimNextTurnDispatch`, `markTurnStarted`, `markTurnCompleted`, `markTurnFailed`, `cancelTurnDispatch`, and `getTurnDispatchState`.
- Introduce persisted dispatch lifecycle state (`queued | claimed | started | completed | failed | cancelled`) and lease reclaim behavior to eliminate silent "accepted but never executed" gaps.
- Update host runtime to use enqueue-first turn send flow with claim-loop dispatching and explicit dispatch state transitions on start, completion, and failure.
- Remove synthetic scheduled turn execution startup path that assumed ownership before runtime confirmation.
- Add host/client wrapper exports for dispatch operations and migrate example/smoke wrappers to dispatch-based send paths.
- Extend thread state diagnostics with dispatch visibility and update integration/operations/react docs for the canonical dispatch contract.
