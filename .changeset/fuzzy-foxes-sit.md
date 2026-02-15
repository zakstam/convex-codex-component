---
"@zakstam/codex-local-component": patch
---

Remove dispatch-managed mode handling from the host runtime API and align tests/examples to runtime-owned dispatch only.
`createCodexHostRuntime().start` no longer accepts a `dispatchManaged` flag, `startClaimedTurn` has been removed from runtime usage, and Tauri example wiring now uses shared dynamic-tool constants.
