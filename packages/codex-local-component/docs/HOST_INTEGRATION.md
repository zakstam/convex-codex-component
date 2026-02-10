# Host Integration Guide

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
- hook helpers: `listThreadMessagesForHooksWithTrustedActor`, `listTurnMessagesForHooksWithTrustedActor`,
  `listPendingApprovalsForHooksWithTrustedActor`, `respondApprovalForHooksWithTrustedActor`,
  `listPendingServerRequestsForHooksWithTrustedActor`, `upsertPendingServerRequestForHooksWithTrustedActor`,
  `resolvePendingServerRequestForHooksWithTrustedActor`,
  `interruptTurnForHooksWithTrustedActor`

```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  ensureSession as ensureSessionHandler,
  ensureThreadByCreate,
  ingestBatchMixed,
  listThreadMessagesForHooksWithTrustedActor,
  registerTurnStart as registerTurnStartHandler,
  vHostActorContext,
  vHostEnsureSessionResult,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostStreamArgs,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
} from "@zakstam/codex-local-component/host/convex";

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
    deltas: v.array(v.union(vStreamInboundEvent, vLifecycleInboundEvent)),
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
    listThreadMessagesForHooksWithTrustedActor(ctx, components.codexLocal, {
      actor: args.actor,
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

- `onEvent`: persist thread-scoped events through `components.codexLocal.sync.ingestSafe`.
- `onGlobalMessage`: process protocol-valid non-thread messages.
- `onProtocolError`: parse/schema failure path; log and recover/restart.
- Modern protocol only: hosts must use app-server `thread/*`, `turn/*`, and `item/*` events.
- Host must keep the runtime loop alive. If the loop is not running, turns can be created but no events will ingest.

### Runtime thread lifecycle controls

`createCodexHostRuntime` supports startup strategy selection:

- `threadStrategy: "start"` (default)
- `threadStrategy: "resume"` with `runtimeThreadId`
- `threadStrategy: "fork"` with `runtimeThreadId`

The runtime also exposes typed app-server lifecycle methods:

- `resumeThread(runtimeThreadId, params?)`
- `forkThread(runtimeThreadId, params?)`
- `archiveThread(runtimeThreadId)`
- `unarchiveThread(runtimeThreadId)`
- `rollbackThread(runtimeThreadId, numTurns)`
- `readThread(runtimeThreadId, includeTurns?)`
- `listThreads(params?)`
- `listLoadedThreads(params?)`
- `listPendingServerRequests(threadId?)`
- `respondCommandApproval({ requestId, decision })`
- `respondFileChangeApproval({ requestId, decision })`
- `respondToolUserInput({ requestId, answers })`

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
