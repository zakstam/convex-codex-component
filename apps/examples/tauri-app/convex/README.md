# Tauri App Convex Functions

This folder contains Convex host wrappers for the Tauri example.

Canonical consumer implementation guidance is in:

- `packages/codex-local-component/LLMS.md`

## File Ownership

- `convex.config.ts`: mounts `codexLocal`
- `actorLock.ts`: app-owned actor binding and server-side identity guard
- `chat.extensions.ts`: app-owned endpoints (`listThreadsForPicker`, `getActorBindingForBootstrap`) using actor lock
- `chat.ts`: stable guarded host surface (exports public `api.chat.*`) built from `defineRuntimeOwnedHostEndpoints(...)`
  - includes guarded deletion wrappers for immediate delete, scheduled delete, cancel/undo, force-run, and job status polling

## Actor Lock

- Public `chat.*` functions require `actor.userId`.
- Actor lock is opt-in via `TAURI_ACTOR_LOCK=1`.
- When enabled, the host binds to the first valid `actor.userId` it sees (or `ACTOR_USER_ID` when set) and rejects mismatched callers.

## Development

From `apps/examples/tauri-app`:

```bash
pnpm run dev:convex
pnpm run dev:convex:once
pnpm run check:wiring:convex
pnpm run typecheck:convex
```
