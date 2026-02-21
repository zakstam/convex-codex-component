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
6. Run `chat.validateHostWiring` during startup.
7. Run package doctor checks during integration and CI.

## Actor Contract

Use `actor: { userId?: string }` at host/runtime/hook boundaries.

- `userId` present: user-scoped isolation.
- `userId` missing: anonymous-only isolation.
- Authentication and actor binding are app-owned concerns.
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

## Minimal Host Wiring

```ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { defineCodexHostDefinitions } from "@zakstam/codex-local-component/host/convex";

const codex = defineCodexHostDefinitions({ components });

export const syncOpenConversationBinding = mutation(codex.mutations.syncOpenConversationBinding);
export const markConversationSyncProgress = mutation(codex.mutations.markConversationSyncProgress);
export const forceRebindConversationSync = mutation(codex.mutations.forceRebindConversationSync);
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

`syncOpenConversationBinding`, `markConversationSyncProgress`, and `forceRebindConversationSync` are the canonical host-side sync engine hooks for local runtime thread mapping + watermark progress.

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
  composer: { onSend },
  interrupt: { onInterrupt },
});
```

## Validation

Run:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run check:host-shim`
- `pnpm run typecheck`
- `pnpm --filter @zakstam/codex-local-component run doctor:integration`

Use `apps/examples/tauri-app` as the reference implementation.
