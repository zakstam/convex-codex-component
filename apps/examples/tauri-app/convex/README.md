# Tauri App Convex Functions

This folder contains Convex host wrappers for the Tauri example.

Canonical consumer implementation guidance is in:

- `packages/codex-local-component/LLMS.md`

## File Ownership

- `convex.config.ts`: mounts `codexLocal`
- `chat.generated.ts`: generated preset wrappers (do not edit)
- `chat.extensions.ts`: app-owned endpoints (`listThreadsForPicker`)
- `chat.ts`: stable entrypoint that re-exports generated + extensions

## Development

From `apps/examples/tauri-app`:

```bash
pnpm run dev:convex
pnpm run dev:convex:once
pnpm run check:wiring:convex
pnpm run typecheck:convex
```

From repo root:

```bash
pnpm run host:check
```
