# Canonical Integration

Canonical default: runtime-owned host integration.

This is the only documented way to integrate this library.
No alternate consumer setup path is supported.

## Steps

1. Mount the component in `convex/convex.config.ts` using `@zakstam/codex-local-component/convex.config`.
2. Define host definitions in `convex/chat.ts` with `defineCodexHostDefinitions(...)` from `@zakstam/codex-local-component/host/convex`.
3. Export explicit Convex `mutation/query` wrappers from `convex/chat.ts`.
4. Start runtime with `createCodexHostRuntime(...)` from `@zakstam/codex-local-component/host`.
5. Build UI with hooks from `@zakstam/codex-local-component/react`.
6. Run `chat.validateHostWiring` during startup (`{ actor, conversationId? }`).
7. Run package doctor checks during integration and CI.

## Actor Contract

Use `actor: { userId?: string; anonymousId?: string }` at host/runtime/hook boundaries.

- `userId` present: user-scoped isolation.
- `userId` missing + `anonymousId` present: anonymous-session isolation.
- Missing both falls back to legacy shared anonymous scope and should be avoided in production integrations.
- Authentication and actor binding are app-owned concerns.
- Actor precedence is consumer-first: host definitions pass through caller actor identity when provided; anonymous calls fall back to the configured host fallback actor.
- Runtime-owned host default now uses a generated per-session `anonymousId` (instead of a shared anonymous user id).
- Prefer `resolveActorFromAuth(ctx, requestedActor?)` from `@zakstam/codex-local-component/host/convex` to derive canonical host actors from `ctx.auth.getUserIdentity()`.

## Conversation Contract

- Runtime-owned `ensureConversationBinding` is single-path.
- Provide `conversationId`.
- Do not expose host identity alternatives in public app host APIs.
- Use `threadSnapshotByConversation`, `listThreadMessagesByConversation`, `listTurnMessagesByConversation`, and `listPendingServerRequestsByConversation` for conversation-scoped reads. These preserve canonical thread-scoped safety contracts:
  - `threadSnapshotByConversation`, `listThreadMessagesByConversation`, `listTurnMessagesByConversation` return `threadStatus` payloads when the thread is missing or unauthorized.
  - `listPendingServerRequestsByConversation` returns `[]` on missing-thread reads to preserve poller array contracts.

## Lifecycle Contract

Bridge lifecycle tracking is canonicalized as push + snapshot:

- Runtime owners use `subscribeLifecycle(listener)` for transitions and `getLifecycleState()` for reconciliation.
- Tauri bridge owners use `bridge.lifecycle.subscribe(listener)` for transitions and `bridge.lifecycle.getState()` for reconciliation.
- Lifecycle snapshots include:
  - `running`
  - `phase` (`idle|starting|running|stopping|stopped|error`)
  - `source` (`runtime|bridge_event|protocol_error|process_exit`)
  - `updatedAtMs`
  - `conversationId`
  - `turnId`

Consumer rule: subscribe first, then fetch a snapshot to reconcile missed events.

Runtime startup is transport-first:

- `connect`/`lifecycle.start` starts bridge transport and runtime session only.
- Thread intent must be explicit via `openThread`/`lifecycle.openThread`.
- `sendTurn`/`turns.send` fail closed until a thread is opened.
- Optional `lifecycleSafeSend` only recovers transport startup; it never infers thread intent.
- For local runtime threads that must be persisted for UI reads, call `importLocalThreadToPersistence(...)` and switch the UI to the returned persisted `conversationId`.
- Import reliability defaults are conservative: runtime import sends bounded ingest chunks (64 deltas) and relies on adaptive splitting for read-limit rejections.
- React sync hydration consumers should use conversation-level `messages.syncProgress` (`syncedCount`, `totalCount`, `syncState`, `label`) instead of per-message sync metadata.
- Sync hydration state events are state-only; retain the latest snapshot messages for the same conversation until a newer snapshot payload arrives.
- Canonical sync-job lifecycle is durable and conversation-scoped: source `collecting -> sealed`, then job execution `queued -> running|retry_wait -> verifying -> succeeded|failed|cancelled` (public query state remains `syncing|synced|failed|cancelled`).
- During `syncing`, send policy should block user sends for correctness.
- Hydration consumers should gate updates by `syncJobId` to avoid stale-event overwrite.

## Minimal Host Wiring

```ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { defineCodexHostDefinitions } from "@zakstam/codex-local-component/host/convex";

const codex = defineCodexHostDefinitions({ components });

export const syncOpenConversationBinding = mutation(codex.mutations.syncOpenConversationBinding);
export const markConversationSyncProgress = mutation(codex.mutations.markConversationSyncProgress);
export const forceRebindConversationSync = mutation(codex.mutations.forceRebindConversationSync);
export const startConversationSyncSource = mutation(codex.mutations.startConversationSyncSource);
export const appendConversationSyncSourceChunk = mutation(codex.mutations.appendConversationSyncSourceChunk);
export const sealConversationSyncSource = mutation(codex.mutations.sealConversationSyncSource);
export const cancelConversationSyncJob = mutation(codex.mutations.cancelConversationSyncJob);
export const getConversationSyncJob = query(codex.queries.getConversationSyncJob);
export const listConversationSyncJobs = query(codex.queries.listConversationSyncJobs);
export const ensureConversationBinding = mutation(codex.mutations.ensureConversationBinding);
export const ensureSession = mutation(codex.mutations.ensureSession);
export const ingestBatch = mutation(codex.mutations.ingestBatch);
export const scheduleDeleteThread = mutation(codex.mutations.scheduleDeleteThread);
export const validateHostWiring = query(codex.queries.validateHostWiring);
export const getDeletionStatus = query(codex.queries.getDeletionStatus);
export const threadSnapshot = query(codex.queries.threadSnapshot); // safe-by-default
export const listThreadMessages = query(codex.queries.listThreadMessages);
```

For Convex `api.chat.*` generated typing, export each endpoint as a named constant.

`syncOpenConversationBinding`, `markConversationSyncProgress`, and `forceRebindConversationSync` remain mapping/projection hooks. Durable sync lifecycle is server-owned through `startConversationSyncSource`, `appendConversationSyncSourceChunk`, `sealConversationSyncSource`, `cancelConversationSyncJob`, `getConversationSyncJob`, and `listConversationSyncJobs`.

Conversation-scoped reads are safe-by-default (`threadSnapshot`, `threadSnapshotByConversation`, `listThreadMessages`, `listThreadMessagesByConversation`, `listTurnMessages`, `listTurnMessagesByConversation`, `listThreadReasoning`, `persistenceStats`, `durableHistoryStats`, `dataHygiene`) and return thread-status payloads for handled read failures. `listPendingServerRequests` and `listPendingServerRequestsByConversation` are also safe-by-default and return an empty array (`[]`) when the thread is missing.

## Host Shim Generation

Canonical DX path: generate `convex/chat.ts` from host surface metadata.

- `pnpm run sync:host-shim`
- `pnpm run check:host-shim`

Use `check:host-shim` in CI/typecheck flows to prevent API drift.

## Minimal React Wiring

```tsx
import { CodexProvider, useCodex } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

// At app root:
<CodexProvider api={api.chat} actor={actor}>
  <Chat />
</CodexProvider>

// In component:
const conversation = useCodex({
  conversationId,
  composer: {
    optimistic: { enabled: true }, // assistant placeholder defaults to enabled
    onSend,
  },
  interrupt: { onInterrupt },
});
```

For deletion lifecycle actions, keep UI fail-closed but responsive with optimistic mutation updates keyed by `getDeletionStatus`:

```tsx
const cancelDeletion = useCodexOptimisticMutation(
  api.chat.cancelDeletion,
  codexOptimisticPresets.deletionStatus.cancel(api.chat.getDeletionStatus),
);
```

## Validation

Run:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run check:host-shim`
- `pnpm run typecheck`
- `pnpm --filter @zakstam/codex-local-component run doctor:integration`

Use `apps/examples/tauri-app` as the reference implementation.
