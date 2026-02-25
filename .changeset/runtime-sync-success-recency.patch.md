---
"@zakstam/codex-runtime": patch
---

Fix runtime conversation binding identity propagation so persisted bindings retain the true runtime thread handle instead of collapsing to `conversationId`, and bump `codex_threads.updatedAt` on sync success so newly synced conversations surface immediately in recency-sorted persisted pickers.
