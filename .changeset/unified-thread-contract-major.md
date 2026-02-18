---
"@zakstam/codex-local-component": minor
---

Remove mode-based host thread wiring and adopt a single-path runtime-owned thread contract.

### Breaking changes

- Remove public host preset `threadMode` configuration.
- Runtime-owned `ensureThread` now requires at least one identity (`threadId` or `externalThreadId`).
- Update host preset behavior to resolve thread bindings through one deterministic path.

### Improvements

- Add canonical default-vs-advanced thread API guidance for consumers.
- Improve tauri example thread list/linking semantics and remove fragile `unlinked` UI behavior.
- Align host docs and references with the single-path thread contract.
