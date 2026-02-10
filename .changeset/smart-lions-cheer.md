---
"@zakstam/codex-local-component": patch
---

Refactor protocol message handling to use canonical event parsing while remaining resilient to valid unknown JSON-RPC shapes from `codex app-server`.

Update host/runtime and example bridges to align on the new protocol helpers, and suppress non-fatal unsupported-shape protocol noise in the Tauri example bridge state.

Refresh examples and host integration docs to match the new ingest/runtime flow.
