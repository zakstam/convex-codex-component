# Persistent CLI App

This app demonstrates the canonical runtime-owned consumer flow against a real Convex backend.
It is an example implementation of the package strategy defined in:

- `packages/codex-local-component/LLMS.md`

Canonical default used here: runtime-owned host integration (`dispatchManaged: false`).

## Run

```bash
pnpm install
cd apps/examples/persistent-cli-app
pnpm run dev:convex
pnpm start
```

## Host Surface Ownership

- `convex/chat.ts`: helper-defined preset wrappers via `defineRuntimeOwnedHostEndpoints(...)`
- `convex/chat.extensions.ts`: optional app-specific additions

## Wiring and Type Checks

```bash
pnpm run dev:convex:once
pnpm run wiring:smoke
pnpm run typecheck
```

## Optional Env

- `CODEX_BIN`
- `CODEX_MODEL`
- `CODEX_CWD`
- `ACTOR_USER_ID`
- `SAVE_STREAM_DELTAS`
- `DELTA_THROTTLE_MS`
