# Codex + Convex Local Component

Local-first Convex component for Codex integrations where Codex runs on the user's machine (`codex app-server` over stdio).

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

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
  syncStreams,
  resumeStream,
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
  args: { actor: vActor, threadId: v.string() },
  handler: async (ctx, args) =>
    listMessages(ctx, components.codexLocal, { actor: args.actor, threadId: args.threadId }),
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
    sessionId: v.string(),
    threadId: v.string(),
    streamArgs: v.optional(v.any()),
  },
  handler: async (ctx, args) => syncStreams(ctx, components.codexLocal, args),
});

export const streamResume = query({
  args: {
    actor: vActor,
    sessionId: v.string(),
    threadId: v.string(),
    streamId: v.string(),
    cursor: v.number(),
  },
  handler: async (ctx, args) => resumeStream(ctx, components.codexLocal, args),
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
