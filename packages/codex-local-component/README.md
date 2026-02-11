# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Convex component for Codex integrations where Codex runs locally on the user's machine (desktop/CLI), while thread state, messages, approvals, and stream recovery live in Convex.

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

React hooks require `react` peer dependency (`^18` or `^19`).

## Integration Contract (Read First)

1. Always use generated Convex types from your app:
   - `./_generated/api`
   - `./_generated/server`
2. Mount the component once with `app.use(codexLocal)`.
3. In Convex server files, use `@zakstam/codex-local-component/host/convex` helper exports.
4. Treat `actor` (`tenantId`, `userId`, `deviceId`) as trusted server identity, not untrusted client input.
5. Before ingesting events on startup/reconnect, call `sync.ensureSession`.
6. For runtime ingest, prefer `sync.ingestSafe` (`ingestBatchMixed` uses this).

## Golden Path

### 1) Mount the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

Run `npx convex dev` once so `components.codexLocal.*` is generated.

### 2) Add host wrappers (`convex/chat.ts`)

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

export const ensureThread = mutation({
  args: { actor: vHostActorContext, threadId: v.string() },
  handler: async (ctx, args) => ensureThreadByCreate(ctx, components.codexLocal, args),
});

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

export const ensureSession = mutation({
  args: { actor: vHostActorContext, sessionId: v.string(), threadId: v.string() },
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

### 3) Run bridge loop (desktop/CLI process)

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
        await convex.mutation(api.chat.ensureSession, { actor, sessionId, threadId });
      }

      await convex.mutation(api.chat.ingestBatch, {
        actor,
        sessionId,
        threadId: event.threadId,
        deltas: [event],
      });
    },
    onGlobalMessage: async () => {
      // handle non-thread protocol messages (auth/config/etc)
    },
    onProtocolError: async ({ error, line }) => {
      console.error("protocol error", error.message, line);
    },
  },
);

bridge.start();
```

### 4) Wire React hooks

```tsx
import { useCodexMessages } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

const actor = { tenantId: "demo", userId: "demo", deviceId: "web-1" };

export function Chat({ threadId }: { threadId: string }) {
  const messages = useCodexMessages(
    api.chat.listThreadMessagesForHooks,
    { actor, threadId },
    { initialNumItems: 30, stream: true },
  );

  return (
    <div>
      {messages.results.map((msg) => (
        <div key={msg._id}>{msg.text}</div>
      ))}
    </div>
  );
}
```

## Required Query Contract for `useCodexMessages`

Your host query must:

- accept `threadId`, `paginationOpts`, optional `streamArgs`
- return durable paginated messages plus optional `streams`

`streamArgs`:

- `{ kind: "list", startOrder?: number }`
- `{ kind: "deltas", cursors: Array<{ streamId: string; cursor: number }> }`

Delta stream response shape includes:

- `streams`
- `deltas`
- `streamWindows` (`ok | rebased | stale`)
- `nextCheckpoints`

## Package Import Paths

- `@zakstam/codex-local-component/convex.config`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/client`
- `@zakstam/codex-local-component/bridge`
- `@zakstam/codex-local-component/app-server`
- `@zakstam/codex-local-component/protocol`

## Implemented

- Initialization handshake
- Thread lifecycle (create, resolve, resume, fork, archive, rollback)
- Turn lifecycle (start, interrupt, idempotency)
- Streamed event ingest and replay with cursor-based sync
- Session lifecycle (`ensureSession`, heartbeat, recovery)
- Account/Auth API surface (`account/read`, `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`)
- Command execution and file change approval flows
- Tool user input flow
- Dynamic tool call response flow
- ChatGPT auth-token refresh response flow (`account/chatgptAuthTokens/refresh`)
- Multi-device stream checkpoints with TTL cleanup

## Not Implemented Yet

- Config management API surface
- MCP management API surface
- Core runtime utility APIs (`command/exec`, `model/list`, `review/start`)
- Skill/App discovery and configuration APIs
- Feedback API
- Collaboration mode listing

## Docs

- `docs/HOST_INTEGRATION.md`
- `docs/CLIENT_AND_REACT_HOOKS.md`
- `docs/OPERATIONS_AND_ERRORS.md`
