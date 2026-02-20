# Example Apps Runbook

Canonical default: runtime-owned host integration.

Use this runbook for shared setup and verification commands referenced by package docs and example app READMEs.

## Shared Preconditions

Run from repository root:

```bash
pnpm install
pnpm run component:build
```

For app-level commands, change into the example app directory first.

## Shared Validation Gates (Convex-Backed Examples)

Run these in the target app directory for Convex-backed examples (Persistent CLI and Tauri):

```bash
npx convex dev --once
pnpm run dev:convex:once
pnpm run check:host-shim
pnpm run typecheck
pnpm --filter @zakstam/codex-local-component run doctor:integration
```

`check:host-shim` is required for generated `api.chat.*` contract stability.

## Persistent CLI Example

Working directory:

```bash
cd apps/examples/persistent-cli-app
```

Required:

- Convex dev must run at least once to make `CONVEX_URL` discoverable.

Optional environment variables:

- `ACTOR_USER_ID`
- `CODEX_BIN`
- `CODEX_MODEL`
- `CODEX_CWD`
- `SAVE_STREAM_DELTAS`
- `DELTA_THROTTLE_MS`

Start flow:

```bash
pnpm run dev:convex
pnpm run sync:host-shim
pnpm start
```

Validation flow:

```bash
pnpm run dev:convex:once
pnpm run check:host-shim
pnpm run typecheck
```

## Tauri Example

Working directory:

```bash
cd apps/examples/tauri-app
```

Required:

- `apps/examples/tauri-app/.env.local` with `VITE_CONVEX_URL=...`

Optional environment variables:

- `VITE_CODEX_MODEL`
- `VITE_CODEX_CWD`
- `TAURI_ACTOR_LOCK`
- `ACTOR_USER_ID`
- `CODEX_BRIDGE_RAW_LOG`
- `CODEX_HELPER_BIN`
- `CODEX_NODE_BIN`

Start flow:

```bash
pnpm run dev:convex
pnpm run sync:host-shim
pnpm run dev
```

Validation flow:

```bash
pnpm run dev:convex:once
pnpm run check:host-shim
pnpm run typecheck
pnpm run tauri:check
```

Host/type boundary validation target used in CI:

```bash
pnpm --filter codex-local-tauri-example run typecheck
```

## Debug Harness

Working directory:

```bash
cd apps/examples/debug-harness
```

Environment behavior:

- Prefers shell/process env values when set.
- Otherwise auto-loads defaults from `apps/examples/tauri-app/.env.local`.
- Requires `VITE_CONVEX_URL` (directly or via `.env.local`) for scenario smoke commands.

Verification flow:

```bash
pnpm run repro:no-response
```

## CLI Example

Working directory:

```bash
cd apps/examples/cli-app
```

Run:

```bash
pnpm start
```

Optional environment variables:

- `CODEX_BIN`
- `CODEX_MODEL`
- `CODEX_CWD`
