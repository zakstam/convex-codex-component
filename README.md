# Codex + Convex Local Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Local-first Convex component for Codex integrations where Codex runs on the user's machine (`codex app-server` over stdio).

## Feature Parity

Implemented:

- Initialization Handshake
- Thread Lifecycle APIs
- Turn Lifecycle APIs
- Streamed Event Ingest/Replay
- Approval Flows
- Tool User Input Flow
- Dynamic Tool Call Response Flow

Not implemented:

- Account/Auth API Surface
- Config Management API Surface
- MCP Management API Surface
- Core Runtime Utility APIs
- Skill/App Discovery and Configuration APIs
- Feedback API
- Collaboration Mode Listing

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

## 10-Minute Quickstart

If you want the shortest successful path, use the Tauri example as the baseline:

1. `cd apps/examples/tauri-app`
2. Create `.env.local` with `VITE_CONVEX_URL=...`
3. Run `pnpm run dev`

What this gives you immediately:

- Convex dev + generated types
- component build watch
- local bridge helper watch
- Tauri app with Vite HMR

Then copy the minimal host + UI pattern from:

- `apps/examples/tauri-app/convex/chat.ts`
- `apps/examples/tauri-app/src/App.tsx`

## 1) Mount the component in Convex

`convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

## 2) Host wrappers with generated Convex types

Always use generated types from `./_generated/*`.

`convex/chat.ts`

```ts
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  getThreadState,
  interruptTurn,
  listMessages,
  listPendingApprovals,
  listTurnMessages,
  respondToApproval,
  startTurn,
  replayStreams,
  resumeStreamReplay,
} from "@zakstam/codex-local-component/client";

const vActor = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
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

export const interruptActiveTurn = mutation({
  args: { actor: vActor, threadId: v.string(), turnId: v.string() },
  handler: async (ctx, args) =>
    interruptTurn(ctx, components.codexLocal, args),
});

export const threadMessages = query({
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

export const turnMessages = query({
  args: { actor: vActor, threadId: v.string(), turnId: v.string() },
  handler: async (ctx, args) =>
    listTurnMessages(ctx, components.codexLocal, args),
});

export const pendingApprovals = query({
  args: { actor: vActor, threadId: v.string() },
  handler: async (ctx, args) =>
    listPendingApprovals(ctx, components.codexLocal, { actor: args.actor, threadId: args.threadId }),
});

export const approvalRespond = mutation({
  args: {
    actor: vActor,
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => respondToApproval(ctx, components.codexLocal, args),
});

export const threadState = query({
  args: { actor: vActor, threadId: v.string() },
  handler: async (ctx, args) => getThreadState(ctx, components.codexLocal, args),
});

export const streamSync = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    streamCursorsById: v.array(v.object({ streamId: v.string(), cursor: v.number() })),
  },
  handler: async (ctx, args) =>
    replayStreams(ctx, components.codexLocal, args),
});

export const streamResume = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    turnId: v.string(),
    fromCursor: v.number(),
  },
  handler: async (ctx, args) =>
    resumeStreamReplay(ctx, components.codexLocal, args),
});

export const ensureThread = mutation({
  args: { actor: vActor, threadId: v.string() },
  handler: async (ctx, args) =>
    ctx.runMutation(components.codexLocal.threads.create, {
      actor: args.actor,
      threadId: args.threadId,
      localThreadId: args.threadId,
    }),
});

export const ingestEvent = mutation({
  args: {
    actor: vActor,
    sessionId: v.string(),
    threadId: v.string(),
    event: v.union(
      v.object({
        type: v.literal("stream_delta"),
        eventId: v.string(),
        turnId: v.string(),
        streamId: v.string(),
        kind: v.string(),
        payloadJson: v.string(),
        cursorStart: v.number(),
        cursorEnd: v.number(),
        createdAt: v.number(),
      }),
      v.object({
        type: v.literal("lifecycle_event"),
        eventId: v.string(),
        turnId: v.optional(v.string()),
        kind: v.string(),
        payloadJson: v.string(),
        createdAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) =>
    ctx.runMutation(components.codexLocal.sync.ingest, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas: args.event.type === "stream_delta" ? [args.event] : [],
      lifecycleEvents: args.event.type === "lifecycle_event" ? [args.event] : [],
    }),
});
```

## 3) Local bridge + event ingestion

```ts
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { CodexLocalBridge } from "@zakstam/codex-local-component/bridge";
import { api } from "../convex/_generated/api.js";

const convex = new ConvexHttpClient(process.env.CONVEX_URL!);
const actor = { tenantId: "demo", userId: "demo", deviceId: "local-1" };
const sessionId = randomUUID();
let threadId: string | null = null;

const bridge = new CodexLocalBridge(
  { cwd: process.cwd() },
  {
    onEvent: async (event) => {
      if (!threadId) {
        threadId = event.threadId;
        await convex.mutation(api.chat.ensureThread, {
          actor,
          threadId,
        });
      }

      await convex.mutation(api.chat.ingestEvent, {
        actor,
        sessionId,
        threadId: event.threadId,
        event,
      });
    },
    onGlobalMessage: async () => {
      // auth/config/global protocol messages
    },
    onProtocolError: async ({ error, line }) => {
      console.error("protocol error", error.message, line);
    },
  },
);

bridge.start();
```

## 4) React hooks (messages, approvals, composer, interrupt, state)

```tsx
import {
  useCodexApprovals,
  useCodexComposer,
  useCodexInterruptTurn,
  useCodexMessages,
  useCodexThreadState,
} from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

const actor = { tenantId: "demo", userId: "demo", deviceId: "web-1" };

export function Chat({ threadId, turnId }: { threadId: string; turnId?: string }) {
  const messages = useCodexMessages(
    api.chat.threadMessages,
    { actor, threadId },
    { initialNumItems: 30, stream: true },
  );

  const approvals = useCodexApprovals(
    api.chat.pendingApprovals,
    { actor, threadId },
    api.chat.approvalRespond,
  );

  const composer = useCodexComposer(api.chat.registerTurnStart);
  const interrupt = useCodexInterruptTurn(api.chat.interruptActiveTurn);
  const state = useCodexThreadState(api.chat.threadState, { actor, threadId });

  return null;
}
```

## Repo examples

- `apps/examples/cli-app`: local runtime + streaming CLI
- `apps/examples/persistent-cli-app`: end-to-end persistence to Convex
- `apps/release-smoke-host`: consumer-style smoke host used for release checks

## Release automation

- Add a changeset in PRs that affect published behavior: `pnpm changeset`
- Merge to `main` creates/updates a Changesets version PR
- Version PR auto-merges when green, then npm publish runs automatically
