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

- `convex/chat.generated.ts`: generated preset wrappers (do not edit)
- `convex/chat.extensions.ts`: app-specific additions
- `convex/chat.ts`: stable Convex entrypoint (`export *`)

Regenerate host wrappers from repo root:

```bash
pnpm run host:generate
```

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
- `ACTOR_TENANT_ID`
- `ACTOR_USER_ID`
- `ACTOR_DEVICE_ID`
- `SAVE_STREAM_DELTAS`
- `DELTA_THROTTLE_MS`
