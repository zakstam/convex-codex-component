# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Convex component for Codex integrations where Codex runs locally while thread state, messages, approvals, and replay are persisted in Convex.

> [!IMPORTANT]
> `@zakstam/codex-local-component` is in **alpha** and ready for active testing.
> It is still experimental and **not** ready for production use.

Canonical default: runtime-owned host integration.

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

React hooks require `react` peer dependency (`^18` or `^19`).

## Canonical Implementation

Use one source of truth for implementation steps:

- `./LLMS.md`

That file is the normative, single-path consumer strategy.

## Quickstart Summary

1. Mount component in `convex/convex.config.ts` with `app.use(codexLocal)`.
2. Define host endpoints directly in `convex/chat.ts` with `defineRuntimeOwnedHostEndpoints(...)`.
3. Optionally keep app-specific additions in `convex/chat.extensions.ts` and re-export from `convex/chat.ts`.
4. Start runtime in runtime-owned mode.
5. Call `chat.validateHostWiring` at startup.
6. Use `@zakstam/codex-local-component/react` hooks against canonical host endpoints.

## Package Import Paths

- `@zakstam/codex-local-component`
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/react-integration`
- `@zakstam/codex-local-component/protocol`
- `@zakstam/codex-local-component/host`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/convex.config`

## Docs Map

- Canonical implementation: `./LLMS.md`
- Host details (aligned to canonical path): `docs/HOST_INTEGRATION.md`
- Client and hooks contracts: `docs/CLIENT_AND_REACT_HOOKS.md`
- API reference (consumer-first quick-start + selected high-value entry points): `docs/API_REFERENCE.md`
- Operations and errors: `docs/OPERATIONS_AND_ERRORS.md`
- Reference matrix: `docs/HOST_PRESET_MATRIX.md`
- Runtime-owned reference details: `docs/RUNTIME_OWNED_REFERENCE_HOST.md`

## Data Lifecycle APIs

The component supports async cascade deletion with job polling:

- `threads.deleteCascade`
- `threads.scheduleDeleteCascade`
- `turns.deleteCascade`
- `turns.scheduleDeleteCascade`
- `threads.purgeActorData`
- `threads.schedulePurgeActorData`
- `threads.cancelScheduledDeletion`
- `threads.forceRunScheduledDeletion`
- `threads.getDeletionJobStatus`

## Type Safety Checks

- `pnpm --filter @zakstam/codex-local-component run typecheck`
- `pnpm --filter @zakstam/codex-local-component run check:unsafe-types`
