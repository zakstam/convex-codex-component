---
"@zakstam/codex-local-component": patch
---

Fix a sync progress validator mismatch where `syncJobState: "idle"` could be emitted by binding progress flows but rejected by component return validators.

This aligns internal binding sync job state contracts with runtime behavior and prevents Convex `ReturnsValidationError` failures in Tauri sync hydration flows.
