---
"@zakstam/codex-local-component": minor
---

Remove unused React hooks (useCodexComposer, useCodexApprovals, useCodexInterruptTurn, useCodexAutoResume) from the public API. Internalize useCodexConversationController (no longer publicly exported; use useCodexChat instead). Remove unused standalone userScope index from codex_stream_deltas_ttl schema.
