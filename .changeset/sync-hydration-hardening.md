---
"@zakstam/codex-runtime": patch
---

Harden sync hydration behavior and runtime reliability:

- Preserve cached sync hydration messages when receiving `bridge/sync_hydration_state` updates.
- Make `syncProgress` unsynced matching robust to scoped (`turnId:messageId`) and plain (`messageId`) identifiers.
- Retry global sync hydration subscription correctly after an initial subscription failure.
- Fix Tauri example bridge helper typecheck regression in failed local-thread import handling.
- Replace empty `catch {}` blocks in package runtime/component code to satisfy fail-closed error-discipline checks.
