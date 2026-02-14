# LLMS: Canonical Consumer Integration (Single Path)

Canonical default: runtime-owned host integration.
Official recommendation: use React hooks as the primary consumer integration surface.
Canonical API map (consumer-first): `docs/API_REFERENCE.md`.

## Actor Scope Contract

- Actor payload is `actor: { userId?: string }`.
- `userId` is optional:
- when present, data access is scoped to that user.
- when omitted, data access is scoped to anonymous-only rows.
- Do not send tenant/device identifiers.

## Hard Rule

- Follow this file as the only default implementation strategy.
- Define host wrappers with `defineRuntimeOwnedHostEndpoints(...)`.
- Always use app-generated Convex types from `./_generated/api` and `./_generated/server`.

## Required Implementation Steps

1. Install package dependencies.

```bash
pnpm add @zakstam/codex-local-component convex
```

2. Mount the component in `convex/convex.config.ts`.

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

3. Generate Convex app types once before host wiring.

```bash
npx convex dev --once
```

- Required so app-generated `./_generated/api` and `./_generated/server` exist and stay authoritative.

4. Define host wrappers from the canonical runtime-owned helper.

```ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  defineRuntimeOwnedHostEndpoints,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

export const SERVER_ACTOR: HostActorContext = Object.freeze({
  ...(process.env.ACTOR_USER_ID ? { userId: process.env.ACTOR_USER_ID } : {}),
});

const defs = defineRuntimeOwnedHostEndpoints({
  components,
  serverActor: SERVER_ACTOR,
});

export const ensureThread = mutation(defs.mutations.ensureThread);
export const enqueueTurnDispatch = mutation(defs.mutations.enqueueTurnDispatch);
export const claimNextTurnDispatch = mutation(defs.mutations.claimNextTurnDispatch);
export const markTurnDispatchStarted = mutation(defs.mutations.markTurnDispatchStarted);
export const markTurnDispatchCompleted = mutation(defs.mutations.markTurnDispatchCompleted);
export const markTurnDispatchFailed = mutation(defs.mutations.markTurnDispatchFailed);
export const cancelTurnDispatch = mutation(defs.mutations.cancelTurnDispatch);
export const ensureSession = mutation(defs.mutations.ensureSession);
export const ingestEvent = mutation(defs.mutations.ingestEvent);
export const ingestBatch = mutation(defs.mutations.ingestBatch);
export const respondApprovalForHooks = mutation(defs.mutations.respondApprovalForHooks);
export const upsertTokenUsageForHooks = mutation(defs.mutations.upsertTokenUsageForHooks);
export const interruptTurnForHooks = mutation(defs.mutations.interruptTurnForHooks);

export const validateHostWiring = query(defs.queries.validateHostWiring);
export const getTurnDispatchState = query(defs.queries.getTurnDispatchState);
export const getDispatchObservability = query(defs.queries.getDispatchObservability);
export const threadSnapshot = query(defs.queries.threadSnapshot);
export const threadSnapshotSafe = query(defs.queries.threadSnapshotSafe);
export const persistenceStats = query(defs.queries.persistenceStats);
export const durableHistoryStats = query(defs.queries.durableHistoryStats);
export const dataHygiene = query(defs.queries.dataHygiene);
export const listThreadMessagesForHooks = query(defs.queries.listThreadMessagesForHooks);
export const listTurnMessagesForHooks = query(defs.queries.listTurnMessagesForHooks);
export const listPendingApprovalsForHooks = query(defs.queries.listPendingApprovalsForHooks);
export const listTokenUsageForHooks = query(defs.queries.listTokenUsageForHooks);
```

5. Use runtime-owned host preset behavior only.

- Host wrappers are based on `defineRuntimeOwnedHostEndpoints(...)`.
- Construct runtime with explicit persistence wiring:

```ts
import { createCodexHostRuntime } from "@zakstam/codex-local-component/host";

const runtime = createCodexHostRuntime({
  persistence: {
    ensureThread,
    ensureSession,
    ingestSafe,
    upsertPendingServerRequest,
    resolvePendingServerRequest,
    listPendingServerRequests,
    enqueueTurnDispatch,
    claimNextTurnDispatch,
    markTurnDispatchStarted,
    markTurnDispatchCompleted,
    markTurnDispatchFailed,
    cancelTurnDispatch,
  },
});
```

- Runtime startup:

```ts
await runtime.start({
  actor,
  sessionId,
  threadStrategy: "start",
});
```

6. Start turns through `runtime.sendTurn(text)`.

7. Validate host wiring during startup.

- Query `chat.validateHostWiring` once at process boot.
- Fail fast if `ok` is `false`.

8. Use React hooks as the canonical UI integration path.

- `useCodexMessages` -> `chat.listThreadMessagesForHooks`
- `useCodexTurn` -> `chat.listTurnMessagesForHooks`
- `useCodexThreadActivity` -> `chat.threadSnapshotSafe`
- `useCodexIngestHealth` -> `chat.threadSnapshotSafe`
- `useCodexBranchActivity` -> `chat.threadSnapshotSafe`
- `useCodexApprovals` -> `chat.listPendingApprovalsForHooks` + `chat.respondApprovalForHooks`
- `useCodexDynamicTools` -> `chat.listPendingServerRequestsForHooks` + runtime `respondDynamicToolCall(...)`
- `useCodexComposer` -> `chat.enqueueTurnDispatch`
- Prefer `useCodexChat` for bundled wiring (messages + activity + approvals + composer + interrupt + explicit tool controls), or `useCodexConversationController` when you need the lower-level contract.
- Use `useCodexRuntimeBridge`, `useCodexAccountAuth`, and `useCodexThreads` for bridge lifecycle, auth flows, and thread selection state in React apps.
- Treat `threadSnapshotSafe` timestamps as terminal-aware authority (`completedAt/updatedAt` before `createdAt`) when deriving terminal boundary decisions.

## Required Consumer Commands

From each host app:

```bash
pnpm run dev:convex:once
pnpm run wiring:smoke
pnpm run typecheck
```

If your app does not define `wiring:smoke`, run the check inline with `ConvexHttpClient` against `chat.validateHostWiring`.

## Required Host Surface Ownership

- `convex/chat.ts` owns preset endpoint exports via `defineRuntimeOwnedHostEndpoints(...)`.
- `convex/chat.extensions.ts` is optional and owns app-specific endpoints only.
- If you use `chat.extensions.ts`, export those endpoints from `convex/chat.ts`.

If an endpoint belongs to preset behavior, add it in the package preset/manifest and consume it through the helper API.

## Advanced Appendix (Non-Default)

Dispatch-managed orchestration is advanced and non-default. Reference only when explicitly requested:

- `docs/DISPATCH_MANAGED_REFERENCE_HOST.md`
