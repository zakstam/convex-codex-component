# Persistence lane

## Purpose

Own host runtime persistence adapters and persistence-facing wiring.
This lane translates runtime persistence operations to concrete backing APIs (currently Convex) without importing host definitions internals.

## Owned files

- `packages/codex-local-component/src/host/persistence/index.ts`
- `packages/codex-local-component/src/host/persistence/convex/convexPersistence.ts`
- `packages/codex-local-component/src/host/persistence/README.md`

## Forbidden dependencies

- Do not import from `host/definitions` internals.
- `check:host-boundaries` enforces this for persistence imports, including:
  - `../definitions/*`
  - `../../definitions/*`

## Expected checks

Run from repo root unless noted.

- `pnpm --filter @zakstam/codex-local-component run check:host-boundaries`
- `pnpm --filter @zakstam/codex-local-component run test -- host-runtime.test.mjs`
- `pnpm --filter @zakstam/codex-local-component run test -- host-ingest-recovery.test.mjs`
