# Tauri Example (Desktop + Convex Persistence)

This app is the blessed reference integration for production-grade React + Convex host wiring.
React hooks are the official recommendation for consumer integrations.

Canonical wiring in this app centers on:
- `useCodexConversationController`
- `useCodexThreadState`
- generated host wrappers in `convex/chat.generated.ts`

Canonical consumer implementation path:

- `packages/codex-local-component/LLMS.md`

## Run

```bash
pnpm install
cd apps/examples/tauri-app
pnpm run dev
```

## Required Env

Create `apps/examples/tauri-app/.env.local`:

```bash
VITE_CONVEX_URL=...
```

Optional:

- `VITE_CODEX_BIN`
- `VITE_CODEX_MODEL`
- `VITE_CODEX_CWD`
- `CODEX_HELPER_BIN`
- `CODEX_NODE_BIN`

## Host Surface Ownership

- `convex/chat.generated.ts`: generated preset wrappers
- `convex/chat.extensions.ts`: app-owned endpoints (for example `listThreadsForPicker`)
- `convex/chat.ts`: stable re-export entrypoint

Regenerate wrappers from repo root:

```bash
pnpm run host:generate
```

## Useful Checks

```bash
pnpm run typecheck:convex
pnpm run check:wiring:convex
pnpm run tauri:check
```
