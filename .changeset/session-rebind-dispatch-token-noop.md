---
"@zakstam/codex-local-component": patch
---

Fix two host-facing persistence failure paths: `sync.ensureSession` now rebinds an existing session to the requested thread for the same actor instead of throwing `E_SYNC_SESSION_THREAD_MISMATCH`, and `dispatch.markTurnStarted` now treats invalid/missing claim tokens as a no-op so dispatch state stays unchanged without an uncaught mutation error.
