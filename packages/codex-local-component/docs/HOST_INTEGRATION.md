# Host Integration Guide

Canonical default: runtime-owned host integration.

This doc is aligned to the single canonical implementation in `../LLMS.md`.

## Actor Scope Contract

Use `actor: { userId?: string }` at all host/component boundaries.

- `userId` present -> identified-user isolation.
- `userId` omitted -> anonymous-only isolation.
- Tenant/device identifiers are not part of the contract.

## Required Flow

1. Mount component in `convex/convex.config.ts`.
2. Define host wrappers in `convex/chat.ts` via `defineRuntimeOwnedHostEndpoints(...)`.
3. Optionally define app-specific endpoints in `convex/chat.extensions.ts` and re-export from `convex/chat.ts`.
4. Submit turns through `await runtime.sendTurn(text)`.
6. Run `chat.validateHostWiring` at startup.

## Mount the Component

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

Run `npx convex dev` once so `components.codexLocal.*` types are generated.

## Define Host Endpoints

```ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  defineRuntimeOwnedHostEndpoints,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

export const SERVER_ACTOR: HostActorContext = Object.freeze({
  ...(process.env.ACTOR_USER_ID ? { userId: process.env.ACTOR_USER_ID } : {}),
});

const defs = defineRuntimeOwnedHostEndpoints({
  components,
  serverActor: SERVER_ACTOR,
});

export const ensureThread = mutation(defs.mutations.ensureThread);
export const ensureSession = mutation(defs.mutations.ensureSession);
export const ingestEvent = mutation(defs.mutations.ingestEvent);
export const ingestBatch = mutation(defs.mutations.ingestBatch);
export const respondApprovalForHooks = mutation(defs.mutations.respondApprovalForHooks);
export const upsertTokenUsageForHooks = mutation(defs.mutations.upsertTokenUsageForHooks);
export const interruptTurnForHooks = mutation(defs.mutations.interruptTurnForHooks);

export const validateHostWiring = query(defs.queries.validateHostWiring);
export const threadSnapshot = query(defs.queries.threadSnapshot);
export const threadSnapshotSafe = query(defs.queries.threadSnapshotSafe);
export const persistenceStats = query(defs.queries.persistenceStats);
export const durableHistoryStats = query(defs.queries.durableHistoryStats);
export const dataHygiene = query(defs.queries.dataHygiene);
export const listThreadMessagesForHooks = query(defs.queries.listThreadMessagesForHooks);
export const listTurnMessagesForHooks = query(defs.queries.listTurnMessagesForHooks);
export const listPendingApprovalsForHooks = query(defs.queries.listPendingApprovalsForHooks);
export const listTokenUsageForHooks = query(defs.queries.listTokenUsageForHooks);
```

This keeps Convex codegen and app-generated types authoritative while avoiding consumer-side file generation.

## Runtime Contract

Runtime startup:

```ts
await runtime.start({
  actor,
  sessionId,
  threadStrategy: "start",
});
```

Turn start API for canonical flow:

```ts
const accepted = await runtime.sendTurn(inputText);
// accepted.turnId is durable once this promise resolves.
```

## Ingest Contract

When calling host ingest mutations directly:

- Send typed deltas only (`type: "stream_delta"` or `type: "lifecycle_event"`).
- Do not rely on untyped fallback envelope shapes.
- Legacy `codex/event/*` entries must include canonical payload turn id (`msg.turn_id`/`msg.turnId`) or ingest is rejected.
- Turn lifecycle stream events (`turn/started`, `turn/completed`) must include canonical payload turn id (`params.turn.id`) or ingest is rejected.

## Thread Snapshot Contract

`chat.threadSnapshotSafe` is the canonical source for activity/integrity hooks.

- `createdAt` indicates when a row first appeared.
- `updatedAt` indicates the latest row mutation.
- `completedAt` is the terminal boundary signal when present.
- Terminal authority decisions should use `completedAt/updatedAt` before `createdAt`.

## Startup Wiring Validation

Call `chat.validateHostWiring` once when your host process starts.

Expected response shape:

- `ok: boolean`
- `checks: Array<{ name: string; ok: boolean; detail?: string }>`

If `ok` is `false`, fail startup and surface details in logs.

## Convex Boundary Rule

Convex-deployed code must not import `@zakstam/codex-local-component/protocol/parser`.
Use host wrapper exports (`@zakstam/codex-local-component/host/convex`) inside Convex functions.
