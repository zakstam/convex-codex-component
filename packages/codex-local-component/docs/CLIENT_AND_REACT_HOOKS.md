# Client Helpers and React Hooks

This package ships a consumer SDK layer:

- `@zakstam/codex-local-component/client`
- `@zakstam/codex-local-component/react`

## Client helpers

Import from `@zakstam/codex-local-component/client`:

- `listMessages`
- `listTurnMessages`
- `listPendingApprovals`
- `respondToApproval`
- `startTurn`
- `interruptTurn`
- `replayStreams`
- `resumeStreamReplay`
- `getThreadState`

These are thin wrappers around component function references and keep generated Convex typing end-to-end.

## React hooks

Import from `@zakstam/codex-local-component/react`:

- `useCodexMessages`
- `useCodexStreamingMessages`
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
  - `{ kind: "deltas", deltas, streamWindows, nextCheckpoints }`

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

## Minimal Integration (Happy Path)

Use this if you want the smallest working consumer setup.

### 1) Host query for hooks

```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { components } from "./_generated/api";

export const listThreadMessagesForHooks = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(v.any()),
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

### 2) Host mutation for ingest

```ts
import { mutation } from "./_generated/server";

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
```

Before ingest, call `components.codexLocal.sync.ensureSession` on startup/reconnect.

### 3) UI hook usage

```tsx
const messages = useCodexMessages(
  api.chat.listThreadMessagesForHooks,
  { actor, threadId },
  { initialNumItems: 30, stream: true },
);
```
