---
"@zakstam/codex-local-component": patch
---

Align host-side ingest recoverability handling with the component contract by using the server-provided `errors[].recoverable` signal.

- add a shared host utility for recoverable ingest error detection
- remove Tauri example's hardcoded `OUT_OF_ORDER`/`REPLAY_GAP` session rollover fallback
- prevent false `sync/session_rolled_over` warnings for non-recoverable ingest failures
