# Client Helpers and React Hooks

This package ships a consumer SDK layer:

- `@zakstam/codex-local-component/client`
- `@zakstam/codex-local-component/react`

For Convex server wrapper files, the canonical integration path is `@zakstam/codex-local-component/host/convex`.

Dispatch orchestration boundary is explicit:

- Use either runtime-owned dispatch (`dispatchManaged: false` + `sendTurn`) or external-worker dispatch (`dispatchManaged: true` + `startClaimedTurn`).
- Do not mix both orchestration paths for the same runtime instance.
- Runtime-specific references:
  - `RUNTIME_OWNED_REFERENCE_HOST.md`
  - `DISPATCH_MANAGED_REFERENCE_HOST.md`

## Client helpers

Import from `@zakstam/codex-local-component/client`:

- `listMessages`
- `listReasoningByThread`
- `listTurnMessages`
- `listPendingApprovals`
- `respondToApproval`
- `listPendingServerRequests`
- `upsertPendingServerRequest`
- `resolvePendingServerRequest`
- `startTurn`
- `interruptTurn`
- `enqueueTurnDispatch`
- `claimNextTurnDispatch`
- `markTurnStarted`
- `markTurnCompleted`
- `markTurnFailed`
- `cancelTurnDispatch`
- `getTurnDispatchState`
- `replayStreams`
- `resumeStreamReplay`
- `createThread`
- `resolveThread`
- `resumeThread`
- `getThreadState`
- `resolveThreadByExternalId`
- `getExternalThreadMapping`
- `listThreads`

These are thin wrappers around component function references and keep generated Convex typing end-to-end.

## React hooks

Import from `@zakstam/codex-local-component/react`:

- `useCodexMessages`
- `useCodexReasoning`
- `useCodexStreamingMessages`
- `useCodexStreamingReasoning`
- `useCodexTurn`
- `useCodexThreadState`
- `useCodexApprovals`
- `useCodexInterruptTurn`
- `useCodexAutoResume`
- `useCodexComposer`
- `optimisticallySendCodexMessage`

### `useCodexMessages` query contract

Your host query must accept:

- `threadId`
- `paginationOpts`
- optional `streamArgs`

`streamArgs` shape:

- `{ kind: "list", startOrder?: number }`
- `{ kind: "deltas", cursors: Array<{ streamId: string; cursor: number }> }`

And return:

- paginated durable message rows (`messageId`, `turnId`, `role`, `status`, `text`, `orderInTurn`, timestamps)
- optional `streams`:
  - `{ kind: "list", streams: Array<{ streamId: string; state: string }> }`
  - `{ kind: "deltas", streams, deltas, streamWindows, nextCheckpoints }`

`streamWindows` entries:

- `{ streamId, status: "ok" | "rebased" | "stale", serverCursorStart, serverCursorEnd }`

`nextCheckpoints` entries:

- `{ streamId, cursor }`

### Merge behavior

`useCodexMessages` uses durable rows as source of truth.
When `stream: true`, stream deltas are overlaid while durable rows are `streaming`.

- terminal statuses override streaming
- longer/extended streamed text can replace in-progress durable text
- dedupe key preference: `(turnId, messageId)` then fallback `(turnId, orderInTurn)`

### Composer send contract

`useCodexComposer` should target a host mutation that accepts:

- `threadId`
- `turnId`
- `idempotencyKey`
- `input: Array<{ type, text?, url?, path? }>`

Recommended: wire it to your host `enqueueTurnDispatch` mutation so accepted user sends are immediately observable in dispatch state (`queued` minimum).
In `dispatchManaged: true` hosts, enqueue via mutation and execute through a sidecar claim loop + `runtime.startClaimedTurn(...)`.

### Reasoning APIs

`useCodexReasoning` reads durable reasoning segments from a reasoning query:

- args: `threadId`, `paginationOpts`, optional `includeRaw`
- returns paginated reasoning rows aggregated by segment key (`turnId + itemId + channel + index`)

`useCodexStreamingReasoning` reads stream overlays from replay deltas:

- tracks `item/reasoning/summaryTextDelta`
- tracks `item/reasoning/summaryPartAdded`
- optionally tracks `item/reasoning/textDelta` when `includeRaw: true`

## Minimal Integration (Happy Path)

Use this if you want the smallest working consumer setup.

### 1) Host query for hooks

```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { vHostStreamArgs } from "@zakstam/codex-local-component/host/convex";

export const listThreadMessagesForHooks = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vHostStreamArgs,
  },
  handler: async (ctx, args) => {
    const paginated = await ctx.runQuery(components.codexLocal.messages.listByThread, {
      actor: args.actor,
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    const streams = args.streamArgs
      ? await ctx.runQuery(components.codexLocal.sync.replay, {
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
              kind: "deltas",
              streams: streams.streams,
              deltas: streams.deltas,
              streamWindows: streams.streamWindows,
              nextCheckpoints: streams.nextCheckpoints,
            }
          : undefined,
      };
    }

    return {
      ...paginated,
      streams: streams ? { kind: "list", streams: streams.streams } : undefined,
    };
  },
});
```

### 2) Host mutation for ingest

```ts
import { mutation } from "./_generated/server";
import { normalizeInboundDeltas } from "@zakstam/codex-local-component/host/convex";

export const ingestBatch = mutation({
  args: {
    actor: vActor,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent)),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeInboundDeltas(args.deltas);
    const streamDeltas = normalized.filter((d) => d.type === "stream_delta");
    const lifecycleEvents = normalized.filter((d) => d.type === "lifecycle_event");
    return ctx.runMutation(components.codexLocal.sync.ingestSafe, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas,
      lifecycleEvents,
    });
  },
});
```

`normalizeInboundDeltas` strips harmless extra fields and canonicalizes payload shape while keeping component validators strict.

Before ingest, call `components.codexLocal.sync.ensureSession` on startup/reconnect.

### 3) UI hook usage

```tsx
const messages = useCodexMessages(
  api.chat.listThreadMessagesForHooks,
  { actor, threadId },
  { initialNumItems: 30, stream: true },
);
```
