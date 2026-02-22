---
"@zakstam/codex-local-component": patch
---

Harden host contract drift around runtime conversation identity and pending request lookup.

- Runtime pending server-request lookup is now strictly conversation-scoped in persistence adapters.
- Runtime resume/fork flows now rebind persistence to switched runtime conversations by default.
- `openThread` supports `persistedConversationId` to explicitly pin persisted conversation identity when it differs from runtime thread identity.
- Host surface metadata is now sourced from a single canonical `HOST_CONTRACT_ARTIFACT` export to reduce manifest drift.
- Tauri bridge process payloads remove duplicate `conversationId` keys in emitted JSON state updates.
