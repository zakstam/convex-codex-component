# LLMS: Canonical Consumer Integration (Single Path)

This file is the automation path for integration.
Canonical default: runtime-owned host integration.

## Hard Rule

Use this sequence only:

1. Mount the component with `@zakstam/codex-local-component/convex.config`.
2. Generate/sync `convex/chat.ts` host shim (explicit Convex exports).
3. Define host endpoints with `defineCodexHostDefinitions(...)` in `convex/chat.ts`.
4. Start runtime with `createCodexHostRuntime(...)`.
5. Build UI with `@zakstam/codex-local-component/react` hooks.
6. Run `pnpm --filter @zakstam/codex-local-component run doctor:integration` before claiming integration complete.

Do not use wrapper/facade host builders.

## Actor Scope Contract

- Actor payload is `actor: { userId?: string }`.
- Authentication and actor binding are consumer/app owned.
- Present `userId` scopes to that user.
- Missing `userId` scopes to anonymous-only rows.

## Conversation Contract

- Runtime-owned `ensureConversationBinding` is single-path.
- Provide `conversationId`.
- `conversationId` is the canonical consumer identity for host/runtime operations.
- Do not expose alternate host identity shapes at public app boundaries.

## Task-to-doc routing

- Canonical integration: `docs/CANONICAL_INTEGRATION.md`
- API map: `docs/API_REFERENCE.md`
- Run/check commands: `docs/EXAMPLE_APPS_RUNBOOK.md`
