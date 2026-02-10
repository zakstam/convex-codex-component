---
"@zakstam/codex-local-component": patch
---

Add dynamic tool call response handling and thread-identity boundary hardening for host runtimes.

- Add typed `item/tool/call` response support in protocol/runtime paths and host docs.
- Enable dynamic tools in the Tauri example with `tauri_get_runtime_snapshot` and local pending-request introspection.
- Clarify and enforce `runtimeThreadId` (app-server) vs `localThreadId` (Convex) across bridge state and UI.
- Stabilize stream overlay state updates to avoid repeated render loops from unchanged delta payloads.
