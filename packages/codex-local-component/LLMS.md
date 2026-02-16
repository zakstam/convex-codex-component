# LLMS: Canonical Consumer Integration (Single Path)

This file is the automation path for canonical integration decisions.

Canonical default: runtime-owned host integration.

Official recommendation: use React hooks as the primary consumer integration surface.

Canonical API map (consumer-first): `docs/API_REFERENCE.md`.

## Task-to-doc routing

- Integration task: `docs/HOST_INTEGRATION.md` (then `docs/CLIENT_AND_REACT_HOOKS.md` for React consumers).
- Setup task: `docs/EXAMPLE_APPS_RUNBOOK.md`.
- Error task: `docs/OPERATIONS_AND_ERRORS.md`.
- Preset/task policy: `docs/HOST_PRESET_MATRIX.md`, `docs/RUNTIME_OWNED_REFERENCE_HOST.md`.

## Actor scope contract

- Actor payload is `actor: { userId?: string }`.
- `userId` is optional.
- Present `userId` scopes to that user.
- Missing `userId` scopes to anonymous-only rows.
- Do not send tenant or device identifiers.

## Hard Rule

- Follow this file as the only default implementation strategy.
- Use runtime-owned host wrappers with a single decision rule:
  - actor binding/lock enabled: use `defineGuardedRuntimeOwnedHostEndpoints(...)` (canonical path)
  - no actor binding/lock: use `defineRuntimeOwnedHostEndpoints(...)` (simple fallback)
- Treat runtime-owned `ensureThread` as single-path: provide `threadId` or `externalThreadId`; do not implement mode branching.
- Keep consumer APIs two-tiered: default (`startThread`/`resumeThread`/list) and advanced identity endpoints only for constrained integrations.
- Always use app-generated Convex types from `./_generated/api` and `./_generated/server`.
