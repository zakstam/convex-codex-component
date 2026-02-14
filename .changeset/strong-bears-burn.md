---
"@zakstam/codex-local-component": minor
---

Add a new high-level `useCodexChat` hook as a dedicated conversation facade for UI consumers.
The new API wraps `useCodexConversationController`, preserves existing surface behavior, and adds explicit tool policy controls for disabling tools and overriding tool handlers. Update docs and the blessed Tauri example to reference the new hook.
