---
"@zakstam/codex-runtime": patch
---

Harden conversation identity boundaries across host runtime and bridge surfaces by:

- rebinding persistence mapping when runtime conversation switches after `thread/start|resume|fork`
- fail-closing `openThread` resume/fork calls with blank or whitespace `conversationId`
- removing legacy Tauri identity aliases (`threadId`, `localThreadId`, `persistedThreadId`) from readiness/open payload behavior
- requiring canonical sync binding methods (`syncOpenBinding`, `markSyncProgress`, `forceRebindSync`) and failing closed when missing
