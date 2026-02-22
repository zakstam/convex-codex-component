---
"@zakstam/codex-local-component": patch
---

Harden runtime and sync edge-case handling by:

- fail-closing unexpected runtime process exits (reject pending requests and transition lifecycle to `process_exit` error state)
- preserving `listThreads` base `messageCount` when per-thread `thread/read` enrichment fails, while reporting protocol errors
- propagating sync-job chunk missing/parse terminal failures to thread binding sync status (`drifted`/`failed`)
- including `system` and `tool` messages in Tauri thread-read sync hydration snapshots
