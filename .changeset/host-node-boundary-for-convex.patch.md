---
"@zakstam/codex-runtime": patch
"@zakstam/codex-runtime-convex": patch
"@zakstam/codex-runtime-bridge-tauri": patch
---

Fix Convex runtime bundling boundaries so host imports no longer pull Node-only bridge modules.

- Remove Node local-adapter implementation from `@zakstam/codex-runtime`.
- Add `CodexLocalBridge` to `@zakstam/codex-runtime-bridge-tauri` for explicit Node bridge imports.
- Add `@zakstam/codex-runtime/host/ingest-recovery` subpath and move Convex adapter imports off `@zakstam/codex-runtime/host`.
- Keep Convex component mount ownership in `@zakstam/codex-runtime-convex/convex.config`.
