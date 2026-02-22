# Runtime Lane

This lane owns runtime lifecycle and bridge event handling for the host package.
It keeps runtime behavior conversation-first and delegates persistence and host definitions through typed boundaries.

## Files Owned Here

- `runtime.ts`
- `runtimeCore.ts`
- `runtimeCoreHandlers.ts`
- `runtimeHelpers.ts`
- `runtimeTypes.ts`
- `index.ts`
- `README.md`

## Forbidden Dependencies

- Do not import `src/host/definitions/**` internals from runtime lane files.
- Do not depend on host definition implementation details; use runtime contracts/types and injected boundaries.
- Keep component-internal model types out of runtime public boundaries.

## Expected Checks

- `pnpm --filter @zakstam/codex-local-component run check:host-boundaries`
- Runtime tests: `pnpm --filter @zakstam/codex-local-component run test -- host-runtime`
- Full package gate when needed: `pnpm --filter @zakstam/codex-local-component run ci`

## Runtime Contracts

- Turn identity is dual-scoped:
  - Persistence lifecycle uses persisted turn ids.
  - Runtime control RPCs (`turn/interrupt`, `turn/steer`) use runtime turn ids.
- Pending server-request lifecycle is terminal-aware and expires using canonical persisted turn identity.
- `stop()` is teardown-deterministic:
  - Flush failures are surfaced as errors, but bridge/reset/lifecycle cleanup still completes.
