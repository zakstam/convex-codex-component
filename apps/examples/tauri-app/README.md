# Tauri Example (Desktop + Convex Persistence)

This example runs `codex app-server` locally inside a desktop shell and persists all thread events to Convex.

## Architecture

- **React + Tauri frontend** renders chat history from Convex via `@zakstam/codex-local-component/react` hooks.
- **Rust host** spawns a Node helper process and forwards events/commands via IPC.
- **Node helper** runs `CodexLocalBridge`, sends protocol calls, and ingests normalized events to Convex.
- **Convex backend** mounts `codexLocal` and exposes generated-type-safe host wrappers in `convex/chat.ts`,
  composed from shared `@zakstam/codex-local-component/host` helpers.

## Run

1. Install dependencies from repo root:

```bash
pnpm install
```

2. Run everything with one command:

```bash
cd apps/examples/tauri-app
pnpm run dev
```

This starts and watches:
- Convex dev server
- `@zakstam/codex-local-component` build watch
- Node helper (`bridge-helper.ts`) build watch
- Tauri dev app (with Vite HMR)

## Required env

Create `apps/examples/tauri-app/.env.local`:

```bash
VITE_CONVEX_URL=...
```

Optional:

- `VITE_CODEX_BIN`
- `VITE_CODEX_MODEL`
- `VITE_CODEX_CWD`
- `CODEX_HELPER_BIN` (optional standalone helper binary path; bypasses Node runtime)
- `CODEX_NODE_BIN` (override Node executable when using JS helper)

## Notes

- Runtime launch strategy is binary-first, then Node+JS:
  1. `CODEX_HELPER_BIN`
  2. bundled `bridge-helper`/`bridge-helper.exe`
  3. bundled/local `bridge-helper.js` with `CODEX_NODE_BIN` or `node`
- Convex wrappers in `convex/chat.ts` use generated types from `convex/_generated/*`.
- Generated type safety checks:
  - `pnpm run check:generated:convex`
  - `pnpm run typecheck:convex` (runs `convex dev --once` + generated check + TS typecheck)
- Tauri bootstrap/check:
  - `pnpm run prepare:tauri-assets`
  - `pnpm run tauri:check`
