# Persistence lane

## Purpose

Own host runtime persistence adapters and persistence-facing wiring.
This lane owns core persistence contracts and default codex-authoritative persistence behavior.
External persistence implementations (for example Convex) live in separate packages and plug in through the runtime `persistence` adapter argument.

## Owned files

- `packages/codex-runtime/src/host/persistence/codexOnlyPersistence.ts`
- `packages/codex-runtime/src/host/persistence/README.md`

## Forbidden dependencies

- Do not import from `host/definitions` internals.
- `check:host-boundaries` enforces this for persistence imports, including:
  - `../definitions/*`
  - `../../definitions/*`

## Expected checks

Run from repo root unless noted.

- `pnpm --filter @zakstam/codex-runtime run check:host-boundaries`
- `pnpm --filter @zakstam/codex-runtime run test -- host-runtime.test.mjs`
- `pnpm --filter @zakstam/codex-runtime run test -- host-ingest-recovery.test.mjs`
