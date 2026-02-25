# Tauri App Convex Functions

This folder contains Convex host wrappers for the Tauri example.

Canonical consumer implementation guidance is in:

- `packages/codex-runtime/LLMS.md`

## File Ownership

- `convex.config.ts`: mounts `codexLocal`
- `actorLock.ts`: app-owned actor binding and server-side identity guard
- `chat.extensions.ts`: app-owned endpoints (`listThreadsForPicker`, `listRuntimeConversationBindingsForPicker`, `getActorBindingForBootstrap`, `resolveOpenTarget`, `validatePickerHostWiring`) using actor lock
- `chat.ts`: generated host shim (exports public `api.chat.*`) built from `defineCodexHostDefinitions(...)`
  - includes deletion wrappers for immediate delete, scheduled delete, cancel/undo, force-run, and job status polling

## Thread API

- Thread picker flow: `chat.listThreadsForPicker`.
- Startup picker wiring preflight: `chat.validatePickerHostWiring`.
- Picker query returns persisted thread metadata only (`conversationId`, `preview`, status, timestamps).
- `chat.listRuntimeConversationBindingsForPicker` maps runtime thread IDs to persisted bindings for local-thread labeling (`local unsynced` vs persisted).
- `chat.resolveOpenTarget` resolves a selected conversation handle to an open target (`bound` or `unbound`) for resume/rebind decisions.
- Runtime-owned `ensureConversationBinding` uses one resolve path and requires `conversationId`.
- Durable sync jobs are exposed through `chat.startConversationSyncSource`, `chat.appendConversationSyncSourceChunk`, `chat.sealConversationSyncSource`, `chat.cancelConversationSyncJob`, `chat.getConversationSyncJob`, and `chat.listConversationSyncJobs`.

## Actor Lock

- Public `chat.*` functions require `actor.userId`.
- Actor lock is opt-in via `TAURI_ACTOR_LOCK=1`.
- When enabled, the host binds to the first valid `actor.userId` it sees (or `ACTOR_USER_ID` when set) and rejects mismatched callers.

## Development

From `apps/examples/tauri-app`:

```bash
pnpm run sync:host-shim
pnpm run dev:convex
pnpm run dev:convex:once
pnpm run check:host-shim
pnpm run typecheck:convex
```
