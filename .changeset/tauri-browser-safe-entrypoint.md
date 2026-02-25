---
"@zakstam/codex-runtime-bridge-tauri": patch
---

Keep the package root entrypoint browser-safe by removing the Node-only local adapter re-export.

- `@zakstam/codex-runtime-bridge-tauri` root now exports only browser-safe Tauri client/artifact APIs.
- Node bridge consumers must import `CodexLocalBridge` from `@zakstam/codex-runtime-bridge-tauri/local-adapter`.
- Update docs and example app imports to match the explicit Node subpath contract.
