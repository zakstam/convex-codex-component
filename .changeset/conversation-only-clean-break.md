---
"@zakstam/codex-runtime": minor
---

Adopt a clean-break conversation-only identity contract at public host/runtime boundaries.

- Remove thread-handle public host surface endpoints and keep only conversation-scoped equivalents.
- Align runtime and Tauri bridge public argument/state contracts to `conversationId`.
- Update example host shims, tests, and docs to the conversation-only contract.
