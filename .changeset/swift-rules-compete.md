---
"@zakstam/codex-local-component": patch
---

Add end-to-end server-request handling for app-server approval and user-input flows.

Persist pending server requests (command approvals, file change approvals, tool user input) through host runtime persistence hooks and expose typed host/client wrappers.

Wire the Tauri example to list, triage, and resolve pending server requests from Convex, and update host integration/docs/tests to match the new contract.
