---
"@zakstam/codex-local-component": patch
---

Fix thread activity phase stuck on "streaming" after turn completion

`deriveCodexThreadActivity` now compares in-flight dispatch/turn timestamps against the latest terminal message (completed/failed/interrupted). Stale orchestration records that lag behind a more recent terminal message no longer keep the phase as "streaming", allowing it to correctly fall through to "idle" or the appropriate terminal state.
