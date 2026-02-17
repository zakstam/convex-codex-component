# Canonical Integration

Canonical default: runtime-owned host integration.

This is the only documented way to integrate this library.

## Steps

1. Mount the component in `convex/convex.config.ts` using `@zakstam/codex-local-component/convex.config`.
2. Define host endpoints in `convex/chat.ts` using `createCodexConvexHost(...)` from `@zakstam/codex-local-component/host/convex`.
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
  createCodexConvexHost,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

export const SERVER_ACTOR: HostActorContext = Object.freeze({
  ...(process.env.ACTOR_USER_ID ? { userId: process.env.ACTOR_USER_ID } : {}),
});

const host = createCodexConvexHost({
  components,
  actorPolicy: {
    mode: "serverActor",
    serverActor: SERVER_ACTOR,
  },
});
const defs = host.defs;

export const ensureThread = mutation(defs.mutations.ensureThread);
export const ensureSession = mutation(defs.mutations.ensureSession);
export const ingestBatch = mutation(defs.mutations.ingestBatch);

export const validateHostWiring = query(defs.queries.validateHostWiring);
export const threadSnapshotSafe = query(defs.queries.threadSnapshotSafe);
export const listThreadMessagesForHooks = query(defs.queries.listThreadMessagesForHooks);
```

## Minimal React Wiring

```tsx
import { useCodexMessages } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

const messages = useCodexMessages(
  api.chat.listThreadMessagesForHooks,
  { actor, threadId },
  { initialNumItems: 30, stream: true },
);
```

## Validation

Run:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run typecheck`

Use `apps/examples/tauri-app` as the reference implementation.
