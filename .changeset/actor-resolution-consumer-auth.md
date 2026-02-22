---
"@zakstam/codex-local-component": patch
---

Unify host preset actor resolution behind a shared helper so query and mutation paths apply the same consumer-managed auth semantics. Clarify docs that consumer-provided `actor.userId` is preserved, with anonymous calls falling back to the runtime-owned default actor (`{}`).
