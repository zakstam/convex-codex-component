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

```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { listMessages, startTurn, replayStreams } from "@zakstam/codex-local-component/client";

const vActor = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
});

const vStreamInboundEvent = v.object({
  type: v.literal("stream_delta"),
  eventId: v.string(),
  turnId: v.string(),
  streamId: v.string(),
  kind: v.string(),
  payloadJson: v.string(),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  createdAt: v.number(),
});

const vLifecycleInboundEvent = v.object({
  type: v.literal("lifecycle_event"),
  eventId: v.string(),
  turnId: v.optional(v.string()),
  kind: v.string(),
  payloadJson: v.string(),
  createdAt: v.number(),
});

export const registerTurnStart = mutation({
  args: {
    actor: vActor,
    threadId: v.string(),
    turnId: v.string(),
    inputText: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) =>
    startTurn(ctx, components.codexLocal, {
      actor: args.actor,
      threadId: args.threadId,
      turnId: args.turnId,
      idempotencyKey: args.idempotencyKey,
      input: [{ type: "text", text: args.inputText }],
    }),
});

export const ingestBatch = mutation({
  args: {
    actor: vActor,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(v.union(vStreamInboundEvent, vLifecycleInboundEvent)),
  },
  handler: async (ctx, args) => {
    const streamDeltas = args.deltas.filter((d) => d.type === "stream_delta");
    const lifecycleEvents = args.deltas.filter((d) => d.type === "lifecycle_event");
    return ctx.runMutation(components.codexLocal.sync.ingestSafe, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas,
      lifecycleEvents,
    });
  },
});

export const listThreadMessagesForHooks = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const paginated = await listMessages(ctx, components.codexLocal, {
      actor: args.actor,
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    const streams = args.streamArgs
      ? await replayStreams(ctx, components.codexLocal, {
          actor: args.actor,
          threadId: args.threadId,
          streamCursorsById:
            args.streamArgs.kind === "deltas" ? args.streamArgs.cursors : [],
        })
      : undefined;

    if (args.streamArgs?.kind === "deltas") {
      return {
        ...paginated,
        streams: streams
          ? {
              kind: "deltas" as const,
              deltas: streams.deltas,
              streamWindows: streams.streamWindows,
              nextCheckpoints: streams.nextCheckpoints,
            }
          : undefined,
      };
    }

    return {
      ...paginated,
      streams: streams ? { kind: "list" as const, streams: streams.streams } : undefined,
    };
  },
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

- `streamWindows`: per-stream status (`ok | rebased | stale`) and server window bounds
- `nextCheckpoints`: server-computed cursors safe to persist

Clients should follow `nextCheckpoints` and treat `rebased/stale` as expected recovery states.

## 7. Approvals

Approval request events are projected from runtime events.
Use:

- `components.codexLocal.approvals.listPending`
- `components.codexLocal.approvals.respond`

to drive approval UI/actions.
