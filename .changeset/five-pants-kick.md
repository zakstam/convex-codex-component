---
"@zakstam/codex-local-component": major
---

Make thread-scoped host reads safe-by-default and add strict query aliases.

- Safe defaults now include `threadSnapshot`, `listThreadMessages`, `listTurnMessages`, `listThreadReasoning`, `persistenceStats`, `durableHistoryStats`, and `dataHygiene`.
- Added `*Strict` query aliases for throw-on-missing behavior.
- Added `resolveActorFromAuth(ctx, requestedActor?)` to canonicalize host actor derivation from `ctx.auth.getUserIdentity()`.
- Added centralized missing-thread classification via `classifyThreadReadError(...)` with canonical `E_THREAD_NOT_FOUND`.
- Removed provider/useCodex cast workarounds by aligning React-side query typing flow.
