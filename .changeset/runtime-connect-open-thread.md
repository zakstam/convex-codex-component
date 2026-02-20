---
"@zakstam/codex-local-component": minor
---

Refactor runtime startup to a transport-first contract with explicit thread intent.

- `createCodexHostRuntime` now uses `connect(...)` for bridge/session startup.
- Thread lifecycle is explicit via `openThread({ strategy, threadHandle? })`.
- `sendTurn(...)` fails closed until a thread has been opened.
- Tauri host client adds `lifecycle.openThread(...)` and keeps `lifecycle.start(...)` as transport-only startup.
