# Canonical Integration

Canonical default: runtime-owned host integration.

This is the only documented way to integrate this library.

## Steps

1. Mount the component in `convex/convex.config.ts` using `@zakstam/codex-local-component/convex.config`.
2. Define host endpoints in `convex/chat.ts` using `createCodexHost(...)` from `@zakstam/codex-local-component/host/convex`.
3. Start runtime with `createCodexHostRuntime(...)` from `@zakstam/codex-local-component/host`.
4. Build UI with hooks from `@zakstam/codex-local-component/react`.
5. Run `chat.validateHostWiring` during startup.

## Actor Contract

Use `actor: { userId?: string }` at host/runtime/hook boundaries.

- `userId` present: user-scoped isolation.
- `userId` missing: anonymous-only isolation.

## Thread Contract

- Runtime-owned `ensureThread` is single-path.
- Provide at least one identity: `threadId` or `externalThreadId`.
- Do not implement mode branching.

## Minimal Host Wiring

```ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  createCodexHost,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

export const SERVER_ACTOR: HostActorContext = Object.freeze({
  userId: process.env.ACTOR_USER_ID ?? "server",
});

const codex = createCodexHost({
  components,
  mutation,
  query,
  actorPolicy: SERVER_ACTOR,
  actorResolver: {
    mutation: async (ctx, actor) => requireBoundActorForMutation(ctx, actor),
    query: async (ctx, actor) => requireBoundActorForQuery(ctx, actor),
  },
});

export const ensureThread = codex.endpoints.ensureThread;
export const ensureSession = codex.endpoints.ensureSession;
export const ingestBatch = codex.endpoints.ingestBatch;
export const scheduleDeleteThread = codex.endpoints.scheduleDeleteThread;
export const validateHostWiring = codex.endpoints.validateHostWiring;
export const getDeletionStatus = codex.endpoints.getDeletionStatus;
export const threadSnapshotSafe = codex.endpoints.threadSnapshotSafe;
export const listThreadMessages = codex.endpoints.listThreadMessages;
```

`createCodexHost` requires explicit `actorPolicy`, and `actorPolicy.userId` must be a non-empty string.

`actorResolver` is optional. When present, it runs before every host mutation/query handler and replaces `args.actor` with the resolved actor. This is the canonical way to enforce actor binding without per-endpoint wrapper boilerplate.

For Convex `api.chat.*` generated typing, export each endpoint as a named constant (for example `export const ensureThread = codex.endpoints.ensureThread`).

## Minimal React Wiring

```tsx
import { CodexProvider, useCodex } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

// At app root:
<CodexProvider api={api.chat} actor={actor}>
  <Chat />
</CodexProvider>

// In component:
const conversation = useCodex({
  threadId,
  composer: { onSend },
  interrupt: { onInterrupt },
});
```

## Validation

Run:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run typecheck`

Use `apps/examples/tauri-app` as the reference implementation.
