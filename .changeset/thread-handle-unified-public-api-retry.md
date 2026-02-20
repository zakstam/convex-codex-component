---
"@zakstam/codex-local-component": minor
---

Unify public thread identity contracts on `threadHandle` across host/component boundaries.

- `threads.list` now returns `threadHandle` in page rows.
- Runtime-owned host endpoints accept `threadHandle` for thread-targeted reads and mutations.
- Adds a package contract test that enforces create/list/send/delete identifier consistency.
