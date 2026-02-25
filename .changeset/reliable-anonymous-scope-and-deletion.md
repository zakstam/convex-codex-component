---
"@zakstam/codex-runtime": minor
---

Improve host/component reliability across actor isolation, safe read fallbacks, and cascade deletion integrity.

- Add `anonymousId` support to host/component actor contracts and use it for anonymous-session scope derivation (`anon:<anonymousId>`), while preserving authenticated `userId` precedence.
- Update runtime-owned default actor behavior to use generated per-session anonymous identities instead of a shared anonymous user id.
- Harden Convex persistence pending-request polling to return `[]` for handled missing-thread read errors instead of throwing.
- Improve stream-delta cascade deletion by scanning/deleting via `streamRef` references and retiring fully drained streams to avoid fixed-window starvation on high-cardinality threads.
