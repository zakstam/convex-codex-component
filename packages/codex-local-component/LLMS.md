# LLMS: Canonical Consumer Integration (Single Path)

This file is the automation path for integration.
Canonical default: runtime-owned host integration.

## Hard Rule

Use this sequence only:

1. Mount the component with `@zakstam/codex-local-component/convex.config`.
2. Define host endpoints with `createCodexHost(...)`.
3. Start runtime with `createCodexHostRuntime(...)`.
4. Build UI with `@zakstam/codex-local-component/react` hooks.

Do not use alternative host builder paths in docs.

## Actor Scope Contract

- Actor payload is `actor: { userId?: string }`.
- Present `userId` scopes to that user.
- Missing `userId` scopes to anonymous-only rows.

## Thread Contract

- Runtime-owned `ensureThread` is single-path.
- Provide `threadId` or `externalThreadId`.
- Do not implement mode branching.

## Task-to-doc routing

- Canonical integration: `docs/CANONICAL_INTEGRATION.md`
- API map: `docs/API_REFERENCE.md`
- Run/check commands: `docs/EXAMPLE_APPS_RUNBOOK.md`
