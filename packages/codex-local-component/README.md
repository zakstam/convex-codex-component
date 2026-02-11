# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Convex component for Codex integrations where Codex runs locally on the user's machine (desktop/CLI), while thread state, messages, approvals, and stream recovery live in Convex.

## Who This Is For

Use this package if you are building:

- a Convex-backed chat/app experience
- with Codex running locally (`codex app-server`)
- and you want durable history + real-time updates + approval flows

This README is optimized for copy/paste into an LLM so it can generate a correct first-pass integration.

## LLM Integration Contract (Read First)

1. Always use generated Convex types from your app:
   - `./_generated/api`
   - `./_generated/server`
2. Mount the component once with `app.use(codexLocal)` in `convex/convex.config.ts`.
3. In Convex server files, prefer `@zakstam/codex-local-component/host/convex` helper exports.
4. Treat `actor` (`tenantId`, `userId`, `deviceId`) as trusted server identity, not untrusted client input.
5. Before ingesting events on startup/reconnect, call `sync.ensureSession`.
6. For runtime ingest, prefer `sync.ingestSafe` (status-driven recovery behavior).

If you skip these rules, the most common failures are missing generated references, session mismatch ingest rejections, and inconsistent hook query contracts.

## Golden Path (15-Minute Integration)

### 1) Install

```bash
pnpm add @zakstam/codex-local-component convex
```

React hooks require `react` peer dependency (`^18` or `^19`).

### 2) Mount the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

Run `npx convex dev` once so `components.codexLocal.*` is generated.

### 3) Add a host wrapper slice (`convex/chat.ts`)

Use helper exports so your wrapper contract stays consistent with the package:

```ts
// convex/chat.ts
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

### 4) Run a bridge runtime loop in desktop/CLI process

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

### 5) Wire React hooks

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

## Required Hook Query Contract

Your `useCodexMessages` query must:

- accept: `threadId`, `paginationOpts`, optional `streamArgs`
- return durable paginated messages plus optional `streams`

`streamArgs`:

- `{ kind: "list", startOrder?: number }`
- `{ kind: "deltas", cursors: Array<{ streamId: string; cursor: number }> }`

`streams` response variant for deltas:

- `streams`
- `deltas`
- `streamWindows` (`ok | rebased | stale`)
- `nextCheckpoints`

Use the helper `listThreadMessagesForHooksForActor` to avoid contract drift.

## Operational Guardrails

- Call `ensureSession` at startup/reconnect before ingest.
- Use `ingestSafe` semantics (`ingestBatchMixed` uses this) and branch on `status`:
  - `ok`
  - `partial`
  - `session_recovered`
  - `rejected`
- For replay recovery, follow `nextCheckpoints` and persist checkpoints.
- Keep bridge runtime loop alive; creating turns without active ingest loop yields no streaming updates.

## Common Integration Mistakes

1. Passing untrusted client actor payloads directly into Convex mutations.
2. Mixing runtime thread id and persisted local `threadId`.
3. Ingesting without `ensureSession` after reconnect.
4. Returning the wrong query shape for `useCodexMessages`.
5. Importing Node runtime helpers in Convex bundle paths instead of `host/convex`.
6. Ignoring `streamWindows` (`rebased`/`stale`) during stream recovery.

## Export Map

- `@zakstam/codex-local-component/client`: typed component helper calls
- `@zakstam/codex-local-component/react`: React hooks and optimistic helpers
- `@zakstam/codex-local-component/bridge`: local `codex app-server` process bridge
- `@zakstam/codex-local-component/protocol`: protocol parsing/classification utilities
- `@zakstam/codex-local-component/app-server`: typed request/response builders
- `@zakstam/codex-local-component/host`: runtime orchestration helpers
- `@zakstam/codex-local-component/host/convex`: Convex-safe validators/handlers (canonical wrapper path)
- `@zakstam/codex-local-component/convex.config`: mountable component definition

## Deep-Dive Docs

- `docs/HOST_INTEGRATION.md`: full host wrapper/runtime patterns
- `docs/CLIENT_AND_REACT_HOOKS.md`: hook contracts and merge behavior
- `docs/OPERATIONS_AND_ERRORS.md`: error catalog and recovery runbook
