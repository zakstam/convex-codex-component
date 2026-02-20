---
"@zakstam/codex-local-component": patch
---

- Make `listPendingServerRequests` safe-by-default for missing threads by removing the missing-thread lookup throw in the component query and returning an empty array when no thread exists.
- Add host preset fallback handling for `listPendingServerRequestsForHooks` to also return `[]` when thread resolution fails for a missing thread.
- Update documentation and safety notes to reflect that this query returns an empty list for missing-thread fallback while other thread reads return status payloads.
