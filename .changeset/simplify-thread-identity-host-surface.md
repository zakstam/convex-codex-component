---
"@zakstam/codex-local-component": minor
---

Redesign runtime-owned host wiring to agent-style definitions + explicit Convex exports.

- Replace `createCodexHost(...)` with `defineCodexHostDefinitions(...)`.
- Remove wrapper/facade host wiring and actor-policy host API inputs.
- Add deterministic host shim rendering (`renderCodexHostShim`) and app `sync/check` scripts.
- Keep `ensureThread` host contract threadId-only and update runtime persistence contract to require `threadId`.
- Fix host `ensureThread` return shaping so internal mapping fields (for example `externalThreadId`) never leak past the public validator contract.
- Update package, example apps, and governance docs to enforce the new architecture.
