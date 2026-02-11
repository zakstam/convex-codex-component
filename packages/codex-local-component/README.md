# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Convex component for Codex integrations where Codex runs locally while thread state, messages, approvals, and replay are persisted in Convex.

Canonical default: runtime-owned host integration (`dispatchManaged: false`).

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
2. Generate host surfaces with `pnpm run host:generate`.
3. Keep host split:
- `convex/chat.generated.ts` (generated)
- `convex/chat.extensions.ts` (app-owned)
- `convex/chat.ts` (re-exports)
4. Start runtime in runtime-owned mode (`dispatchManaged: false`).
5. Call `chat.validateHostWiring` at startup.
6. Use `@zakstam/codex-local-component/react` hooks against canonical host endpoints.

## Package Import Paths

- `@zakstam/codex-local-component/convex.config`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/client`
- `@zakstam/codex-local-component/bridge`
- `@zakstam/codex-local-component/app-server`
- `@zakstam/codex-local-component/protocol`

## Docs Map

- Canonical implementation: `./LLMS.md`
- Host details (aligned to canonical path): `docs/HOST_INTEGRATION.md`
- Client and hooks contracts: `docs/CLIENT_AND_REACT_HOOKS.md`
- Operations and errors: `docs/OPERATIONS_AND_ERRORS.md`
- Reference matrix: `docs/HOST_PRESET_MATRIX.md`
- Advanced appendix (non-default): `docs/DISPATCH_MANAGED_REFERENCE_HOST.md`
- Runtime-owned reference details: `docs/RUNTIME_OWNED_REFERENCE_HOST.md`

## Type Safety Checks

- `pnpm --filter @zakstam/codex-local-component run typecheck`
- `pnpm --filter @zakstam/codex-local-component run check:unsafe-types`
