# Host Integration Guide

Canonical path: in Convex server files, use `@zakstam/codex-local-component/host/convex` helper exports as the default integration path.

## 1. Install and mount

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

Run `npx convex dev` so `components.codexLocal.*` references are generated.

## 1.5 Minimal host file (copy/paste baseline)

Start with one `convex/chat.ts` that handles:

- turn start
- event ingest
- messages query for `useCodexMessages`

Prefer the shared host slice helpers from `@zakstam/codex-local-component/host/convex` in Convex server files so wrapper behavior stays consistent across apps without pulling Node-only runtime code into Convex bundling.
Use:

- validators: `vHostActorContext`, `vHostInboundEvent`, `vHostStreamInboundEvent`, `vHostLifecycleInboundEvent`
- shared returns: `vHostEnsureSessionResult`, `vHostIngestSafeResult`
- handlers: `ensureThreadByCreate` or `ensureThreadByResolve`, `ensureSession`, `registerTurnStart`,
  `ingestEventStreamOnly` / `ingestEventMixed`, `ingestBatchStreamOnly` / `ingestBatchMixed`,
  `threadSnapshot`, `persistenceStats`, `durableHistoryStats`, `dataHygiene`
- hook helpers: `listThreadMessagesForHooksForActor`, `listTurnMessagesForHooksForActor`,
  `listThreadReasoningForHooksForActor`,
  `listPendingApprovalsForHooksForActor`, `respondApprovalForHooksForActor`,
  `listPendingServerRequestsForHooksForActor`, `upsertPendingServerRequestForHooksForActor`,
  `resolvePendingServerRequestForHooksForActor`,
  `interruptTurnForHooksForActor`

```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  ensureSession as ensureSessionHandler,
  ensureThreadByCreate,
  ingestBatchMixed,
  listThreadMessagesForHooksForActor,
  registerTurnStart as registerTurnStartHandler,
  vHostActorContext,
  vHostEnsureSessionResult,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostStreamArgs,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
} from "@zakstam/codex-local-component/host/convex";

const SERVER_ACTOR = {
  tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
  deviceId: process.env.ACTOR_DEVICE_ID ?? "server-device",
};

export const registerTurnStart = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    inputText: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => registerTurnStartHandler(ctx, components.codexLocal, args),
});

export const ensureThread = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => ensureThreadByCreate(ctx, components.codexLocal, args),
});

export const ensureSession = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
  },
  returns: vHostEnsureSessionResult,
  handler: async (ctx, args) => ensureSessionHandler(ctx, components.codexLocal, args),
});

export const ingestBatch = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent)),
    runtime: v.optional(vHostSyncRuntimeOptions),
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) => ingestBatchMixed(ctx, components.codexLocal, args),
});

export const listThreadMessagesForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vHostStreamArgs,
    runtime: v.optional(vHostSyncRuntimeOptions),
  },
  handler: async (ctx, args) =>
    listThreadMessagesForHooksForActor(ctx, components.codexLocal, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      streamArgs: args.streamArgs,
      runtime: args.runtime,
    }),
});
```

## 2. Actor trust boundary

Every public API call requires trusted actor identity:

- `actor.tenantId`
- `actor.userId`
- `actor.deviceId`

Do not pass these directly from untrusted client payloads.

## 3. Bridge runner contract

Use `CodexLocalBridge` from desktop/CLI runtime and provide:

- `onEvent`: persist turn-scoped runtime events (`turn/*`, `item/*`, `error`) through `components.codexLocal.sync.ingestSafe`.
- `onGlobalMessage`: process protocol-valid non-thread messages.
- `onProtocolError`: parse/schema failure path; log and recover/restart.
- Modern protocol only: hosts must use app-server `thread/*`, `turn/*`, and `item/*` events.
- Host must keep the runtime loop alive. If the loop is not running, turns can be created but no events will ingest.

### Runtime thread lifecycle controls

`createCodexHostRuntime` supports startup strategy selection:

- `threadStrategy: "start"` (default)
- `threadStrategy: "resume"` with `runtimeThreadId`
- `threadStrategy: "fork"` with `runtimeThreadId`
- optional `dynamicTools` on `start` and `resumeThread` for dynamic tool registration

The runtime also exposes typed app-server lifecycle methods:

- `resumeThread(runtimeThreadId, params?)`
- `forkThread(runtimeThreadId, params?)`
- `archiveThread(runtimeThreadId)`
- `unarchiveThread(runtimeThreadId)`
- `rollbackThread(runtimeThreadId, numTurns)`
- `readThread(runtimeThreadId, includeTurns?)`
- `readAccount(params?)`
- `loginAccount(params)`
- `cancelAccountLogin(params)`
- `logoutAccount()`
- `readAccountRateLimits()`
- `listThreads(params?)`
- `listLoadedThreads(params?)`
- `listPendingServerRequests(localThreadId?)`
- `respondCommandApproval({ requestId, decision })`
- `respondFileChangeApproval({ requestId, decision })`
- `respondToolUserInput({ requestId, answers })`
- `respondDynamicToolCall({ requestId, success, contentItems })`
- `respondChatgptAuthTokensRefresh({ requestId, idToken, accessToken })`

`listPendingServerRequests` filters by the persisted local thread id (Convex `threadId`), not the app-server runtime thread id.
`account/chatgptAuthTokens/refresh` pending requests are tracked in runtime memory only (not persisted in Convex `serverRequests` tables).
`getState()` includes ingest counters (`enqueuedEventCount`, `skippedEventCount`, and per-kind breakdowns) so hosts can diagnose unexpected idle ingest traffic.

Guardrail: lifecycle mutation methods are blocked while a turn is in flight.

## 4. Minimum ingest/replay flow

1. Resolve thread identity:
   - if you have app IDs, call `threads.resolve` with `externalThreadId`
   - use the returned component `threadId` for all sync calls
2. `sync.ensureSession` at session start/reconnect.
3. `sync.ingestSafe` with split payload:
   - `streamDeltas`
   - `lifecycleEvents`
4. Read durable history using `messages.listByThread` / `messages.getByTurn`.
5. For stream recovery/reconnect:
   - read with `sync.replay`
   - optionally use `sync.resumeReplay` for targeted stream continuation
   - persist cursors with `sync.upsertCheckpoint`
   - inspect persisted cursors with `sync.listCheckpoints`

`ingestSafe` returns a typed status (`ok | partial | session_recovered | rejected`) plus normalized error codes, so host wrappers can recover without throwing for expected reconnect races.

## 5. Runtime tuning

`sync.ingest`, `sync.replay`, and `sync.resumeReplay` support:

- `saveStreamDeltas` (default `false`)
- `saveReasoningDeltas` (default `true`)
- `exposeRawReasoningDeltas` (default `false`)
- `maxDeltasPerStreamRead` (default `100`)
- `maxDeltasPerRequestRead` (default `1000`)
- `finishedStreamDeleteDelayMs` (default `300000`)

## 6. Replay contract

`sync.replay` returns deltas plus replay metadata:

- `streams`: active stream list for the thread
- `streamWindows`: per-stream status (`ok | rebased | stale`) and server window bounds
- `nextCheckpoints`: server-computed cursors safe to persist

Clients should follow `nextCheckpoints` and treat `rebased/stale` as expected recovery states.

## 7. Approvals

Approval request events are projected from runtime events.
Use:

- `components.codexLocal.approvals.listPending`
- `components.codexLocal.approvals.respond`

to drive approval UI/actions.

## 8. Server-request responses

App-server can send server-initiated JSON-RPC requests that require client responses:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `item/tool/call`

The runtime tracks these as pending requests and exposes typed response methods.
For persisted host workflows, wire runtime persistence hooks to:

- `components.codexLocal.serverRequests.upsertPending`
- `components.codexLocal.serverRequests.listPending`
- `components.codexLocal.serverRequests.resolve`

Recommended flow:

1. listen for pending requests (`listPendingServerRequests` or Convex query)
2. collect user decision/answers
3. call matching runtime response API
4. runtime sends JSON-RPC response and marks request answered/expired
