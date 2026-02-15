---
"@zakstam/codex-local-component": patch
---

Fix the send lifecycle gap by durably accepting turns before runtime dispatch and reconciling accepted sends to a terminal state on runtime failure.

- Add two-phase host send contract (`acceptTurnSend` + `failAcceptedTurnSend`) and make `runtime.sendTurn(...)` await durable accept.
- Reconcile accepted sends on dispatch and handler failure paths so turns do not remain non-terminal.
- Fail closed on missing-thread reads in message listing by returning an empty page.
- Update host integration docs and Tauri reference helper wiring for the new persistence contract.
