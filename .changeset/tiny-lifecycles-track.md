---
"@zakstam/codex-local-component": minor
---

Add a canonical bridge lifecycle contract for external consumers.

- Add runtime lifecycle APIs: `subscribeLifecycle(listener)` and `getLifecycleState()`.
- Extend lifecycle snapshots with `phase`, `source`, and `updatedAtMs`.
- Add Tauri lifecycle subscription support via `bridge.lifecycle.subscribe(listener)` with `getState()` reconciliation.
- Update example app wiring and docs to use the package-owned push+snapshot lifecycle contract.
