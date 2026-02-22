---
"@zakstam/codex-local-component": patch
---

Fix local thread import synthetic ingest cursors to be continuous per stream, preventing false `partial` sync states for large conversation hydration imports.
