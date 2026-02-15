# Example App Runbook

Canonical workflow for the repository example apps.

## Shared Local Setup

From repo root:

```bash
pnpm install
```

## Environment Variables

Use the app-specific variable sets below before running an example.

### Tauri Example

- `VITE_CONVEX_URL`

Optional:

- `VITE_CODEX_BIN`
- `VITE_CODEX_MODEL`
- `VITE_CODEX_CWD`
- `CODEX_HELPER_BIN`
- `CODEX_NODE_BIN`
- `CODEX_BRIDGE_RAW_LOG` (`all` for every app-server line, `turns` for turn-focused lines)

### Persistent CLI Example

- `CODEX_BIN`
- `CODEX_MODEL`
- `CODEX_CWD`
- `ACTOR_USER_ID`
- `SAVE_STREAM_DELTAS`
- `DELTA_THROTTLE_MS`

## App Run Recipes

### Tauri Example

```bash
cd apps/examples/tauri-app
pnpm run dev
```

### Persistent CLI Example

```bash
cd apps/examples/persistent-cli-app
pnpm run dev:convex
pnpm start
```

## Verification Commands

### Tauri Example

```bash
pnpm run typecheck:convex
pnpm run check:wiring:convex
pnpm run tauri:check
```

### Persistent CLI Example

```bash
pnpm run dev:convex:once
pnpm run wiring:smoke
pnpm run typecheck
```

