---
"@zakstam/codex-runtime": minor
---

Add durable conversation-scoped sync job metadata (`syncJobId`, job state, policy/version, timestamps, cursor/error fields) to sync progress mutations, gate hydration updates by `syncJobId`, and enforce block-send policy while sync is in-flight.
