<p align="center">
  <strong>@zakstam/codex-local-component</strong>
</p>

<p align="center">
  A <a href="https://convex.dev">Convex</a> component that bridges
  <a href="https://github.com/openai/codex">Codex</a> running locally on the user's machine
  to a persistent, real-time backend — threads, streaming, approvals, and all.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@zakstam/codex-local-component">
    <img src="https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component" alt="npm version" />
  </a>
</p>

---

## How It Works

```
  Your App (React)          Convex Backend            User's Machine
 ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
 │                  │    │                  │    │                  │
 │  useCodex*()  ◄──┼────┼── 14 tables      │    │  codex           │
 │  hooks           │    │  threads, turns  │    │  app-server      │
 │                  │    │  messages,       │    │  (stdio)         │
 │  Composer ───────┼────┼─► streams,       │    │       │          │
 │  Approvals ──────┼────┼─► approvals      │    │       │          │
 │                  │    │                  │    │       ▼          │
 └──────────────────┘    └────────┬─────────┘    │  CodexLocal-    │
                                  │              │  Bridge          │
                                  │              │       │          │
                                  ◄──────────────┼───────┘          │
                                 ingest events   │                  │
                                                 └──────────────────┘
```

The bridge spawns `codex app-server` as a child process, parses its JSON-RPC output, normalizes events, and pushes them into Convex. Your React app subscribes to the same Convex tables through hooks — messages stream in real-time, approvals appear as they're requested, and thread state stays consistent across devices.

---

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

React hooks require `react` as a peer dependency (v18 or v19).

---

## Quickstart

> The fastest way to see everything working end-to-end is the **Tauri example** in the repo.

```bash
cd apps/examples/tauri-app
echo "VITE_CONVEX_URL=..." > .env.local
pnpm run dev
```

This starts Convex dev, the component build watcher, the local bridge helper, and a Tauri app with Vite HMR — all in one command.

For a headless demo, try the persistent CLI app:

```bash
cd apps/examples/persistent-cli-app
pnpm run dev:convex   # start Convex backend
pnpm start            # start bridge + CLI
```

---

## Integration Guide

### Step 1 — Mount the component

In your Convex app config, mount the component so its 14 tables and functions are available:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

### Step 2 — Write host wrappers

Create thin Convex functions that delegate to the component's client helpers. These are your app's public API — you control the arg shapes and auth logic.

**Thread + turn management:**

```ts
// convex/chat.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { startTurn, interruptTurn, getThreadState } from "@zakstam/codex-local-component/client";

const vActor = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
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
  handler: async (ctx, args) => interruptTurn(ctx, components.codexLocal, args),
});

export const threadState = query({
  args: { actor: vActor, threadId: v.string() },
  handler: async (ctx, args) => getThreadState(ctx, components.codexLocal, args),
});
```

**Messages with streaming:**

```ts
// convex/chat.ts (continued)
import { paginationOptsValidator } from "convex/server";
import { listMessages, listTurnMessages, replayStreams, resumeStreamReplay } from "@zakstam/codex-local-component/client";

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
  handler: async (ctx, args) => listTurnMessages(ctx, components.codexLocal, args),
});
```

**Approvals:**

```ts
// convex/chat.ts (continued)
import { listPendingApprovals, respondToApproval } from "@zakstam/codex-local-component/client";

export const pendingApprovals = query({
  args: { actor: vActor, threadId: v.string() },
  handler: async (ctx, args) =>
    listPendingApprovals(ctx, components.codexLocal, {
      actor: args.actor,
      threadId: args.threadId,
    }),
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
```

**Event ingestion + stream sync:**

```ts
// convex/chat.ts (continued)
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

export const streamSync = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    streamCursorsById: v.array(v.object({ streamId: v.string(), cursor: v.number() })),
  },
  handler: async (ctx, args) => replayStreams(ctx, components.codexLocal, args),
});

export const streamResume = query({
  args: {
    actor: vActor,
    threadId: v.string(),
    turnId: v.string(),
    fromCursor: v.number(),
  },
  handler: async (ctx, args) => resumeStreamReplay(ctx, components.codexLocal, args),
});
```

### Step 3 — Set up the local bridge

The bridge spawns `codex app-server` as a child process, parses its stdio output, and pushes normalized events into Convex:

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
        await convex.mutation(api.chat.ensureThread, { actor, threadId });
      }

      await convex.mutation(api.chat.ingestEvent, {
        actor,
        sessionId,
        threadId: event.threadId,
        event,
      });
    },
    onGlobalMessage: async () => {
      // handle auth/config/global protocol messages
    },
    onProtocolError: async ({ error, line }) => {
      console.error("protocol error", error.message, line);
    },
  },
);

bridge.start();
```

### Step 4 — Connect React hooks

The hooks subscribe to your host wrappers and handle pagination, streaming overlays, and optimistic updates:

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

export function Chat({ threadId }: { threadId: string }) {
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

  return (
    <div>
      {messages.results.map((msg) => (
        <div key={msg._id}>{msg.text}</div>
      ))}
    </div>
  );
}
```

---

## Package Exports

The package ships multiple subpath exports. Import only what you need.

### `@zakstam/codex-local-component/client`

Typed helpers for calling component functions from your Convex host wrappers.

| Export | Kind | Purpose |
|---|---|---|
| `createThread` | mutation | Create a new thread |
| `resolveThread` | mutation | Resolve thread by external ID |
| `resumeThread` | mutation | Resume an existing thread |
| `getThreadState` | query | Get thread status and active turn |
| `listThreads` | query | List threads for a tenant |
| `startTurn` | mutation | Begin a new conversation turn |
| `interruptTurn` | mutation | Cancel an active turn |
| `listMessages` | query | Paginated thread messages |
| `listTurnMessages` | query | Messages for a specific turn |
| `listReasoningByThread` | query | Reasoning segments for a thread |
| `listPendingApprovals` | query | Approvals awaiting response |
| `respondToApproval` | mutation | Accept or decline an approval |
| `listPendingServerRequests` | query | Pending server requests |
| `resolvePendingServerRequest` | mutation | Resolve a server request |
| `replayStreams` | query | Replay stream deltas from cursors |
| `resumeStreamReplay` | query | Resume replay for a turn |

### `@zakstam/codex-local-component/react`

React hooks that subscribe to your host wrappers with real-time updates.

| Export | Purpose |
|---|---|
| `useCodexMessages` | Paginated messages with streaming overlay |
| `useCodexStreamingMessages` | Messages with delta-level streaming |
| `useCodexReasoning` | Reasoning segments |
| `useCodexStreamingReasoning` | Reasoning with streaming |
| `useCodexThreadState` | Thread status and active turn info |
| `useCodexTurn` | Turn-scoped messages and state |
| `useCodexApprovals` | Pending approvals + respond callback |
| `useCodexComposer` | Mutation to start a new turn |
| `useCodexInterruptTurn` | Mutation to interrupt active turn |
| `useCodexAutoResume` | Auto-resume streams on stale cursors |
| `optimisticallySendCodexMessage` | Optimistic UI helper for sends |

### `@zakstam/codex-local-component/bridge`

Local process adapter for `codex app-server` over stdio.

| Export | Purpose |
|---|---|
| `CodexLocalBridge` | Spawns and manages the Codex process |

### `@zakstam/codex-local-component/protocol`

Wire protocol types and parsing utilities.

| Export | Purpose |
|---|---|
| `parseWireMessage` | Parse raw JSON-RPC lines |
| `classifyMessage` | Classify messages by scope |
| `normalizeEvent` | Normalize to `NormalizedEvent` |

### `@zakstam/codex-local-component/app-server`

Typed request/response builders for the Codex app-server JSON-RPC protocol.

| Export | Purpose |
|---|---|
| `buildInitializeRequest` | Initialization handshake |
| `buildThreadStartRequest` | Start a new thread |
| `buildThreadResumeRequest` | Resume an existing thread |
| `buildTurnStartTextRequest` | Start a text turn |
| `buildTurnInterruptRequest` | Interrupt active turn |
| `buildAccountReadRequest` | Read account/auth state |
| `buildAccountLoginStartRequest` | Start account login |
| `buildAccountLoginCancelRequest` | Cancel account login |
| `buildAccountLogoutRequest` | Log out account |
| `buildAccountRateLimitsReadRequest` | Read account rate limits |
| `buildCommandExecutionApprovalResponse` | Respond to command approval |
| `buildFileChangeApprovalResponse` | Respond to file change approval |
| `buildToolRequestUserInputResponse` | Respond to tool input request |
| `buildDynamicToolCallResponse` | Respond to dynamic tool call |
| `buildChatgptAuthTokensRefreshResponse` | Respond to ChatGPT auth-token refresh request |

### `@zakstam/codex-local-component/host`

Server-side runtime orchestration for advanced integrations (Tauri, Electron, custom hosts).

| Export | Purpose |
|---|---|
| `createCodexHostRuntime` | Full lifecycle orchestrator with startup strategy, tool registration, and server-request handling |
| `vHostActorContext` | Convex validator for actor context |
| `vHostInboundEvent` | Convex validator for inbound events |

### `@zakstam/codex-local-component/convex.config`

The Convex component definition. Used in `app.use(codexLocal)`.

---

## Data Model

The component manages 14 Convex tables, all multi-tenant by default (scoped to `tenantId`):

| Table | Purpose |
|---|---|
| `codex_threads` | Thread metadata (status, model, personality) |
| `codex_thread_bindings` | External ID → internal thread mapping |
| `codex_turns` | Turn records with status and timing |
| `codex_items` | Generic items (user messages, agent messages, command executions) |
| `codex_messages` | Durable text messages with role and status |
| `codex_streams` | Stream metadata and state tracking |
| `codex_stream_stats` | Delta counts and cursor positions |
| `codex_stream_deltas_ttl` | Stream deltas with automatic TTL cleanup |
| `codex_stream_checkpoints` | Per-device stream ack checkpoints |
| `codex_reasoning_segments` | Reasoning text (summary and raw channels) |
| `codex_sessions` | Session lifecycle and heartbeat tracking |
| `codex_approvals` | Command/file change approvals (pending, accepted, declined) |
| `codex_server_requests` | Dynamic server requests (tool-input, dynamic-tool-call) |
| `codex_lifecycle_events` | Lifecycle event records |

---

## Feature Status

**Implemented:**

- Initialization handshake
- Thread lifecycle (create, resume, fork, archive, rollback)
- Turn lifecycle (start, interrupt, idempotency)
- Streamed event ingest and replay with cursor-based sync
- Account/Auth API surface (`account/read`, `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`)
- Command execution and file change approval flows
- Tool user input flow
- Dynamic tool call response flow
- ChatGPT auth-token refresh response flow (`account/chatgptAuthTokens/refresh`)
- Multi-device stream checkpoints with TTL cleanup

**Not yet implemented:**

- Config management API surface
- MCP management API surface
- Core runtime utility APIs (`command/exec`, `model/list`, `review/start`)
- Skill/App discovery and configuration APIs
- Feedback API
- Collaboration mode listing

---

## Examples

| Example | What it demonstrates |
|---|---|
| [`apps/examples/cli-app`](apps/examples/cli-app) | Ephemeral CLI — bridge + stdio only, no persistence |
| [`apps/examples/persistent-cli-app`](apps/examples/persistent-cli-app) | Full end-to-end — bridge, Convex ingest, message history, stream replay |
| [`apps/examples/tauri-app`](apps/examples/tauri-app) | Desktop app — React + Vite + Tauri with multi-process bridge helper |
| [`apps/release-smoke-host`](apps/release-smoke-host) | Consumer-style smoke host for release validation |

---

## Release Automation

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

1. Add a changeset in PRs that affect published behavior: `pnpm changeset`
2. Merging to `main` creates or updates a Changesets version PR
3. The version PR auto-merges when CI passes, then `npm publish` runs automatically
