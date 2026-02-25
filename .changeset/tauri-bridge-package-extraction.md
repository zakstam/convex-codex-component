---
"@zakstam/codex-runtime": minor
---

Extract Tauri bridge APIs into `@zakstam/codex-runtime-bridge-tauri`.

- Remove `@zakstam/codex-runtime/host/tauri` from the core package export surface.
- Move canonical Tauri bridge client and artifact-generation APIs to `@zakstam/codex-runtime-bridge-tauri`.
- Update Tauri example and debug harness imports to the new package.
