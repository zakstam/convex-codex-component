# External API Simplification Design

## Problem

The consumer integration for `@zakstam/codex-local-component` required ~30 lines of backend boilerplate to re-export individual mutations/queries, ~1150 lines of runtime wiring for event batching and session management, and 15+ React hooks to learn and compose.

## Solution

### Backend: Actor Policy Shorthand + Unified Endpoints

`createCodexHost` now accepts string or `{ userId }` shorthand for `actorPolicy`:

```ts
const codex = createCodexHost({
  components, mutation, query,
  actorPolicy: "server", // shorthand for { mode: "serverActor", serverActor: { userId: "server" } }
});

export const { ensureThread, ensureSession, ingestBatch, validateHostWiring,
  listThreadMessages, listTokenUsage /* ... */ } = codex.endpoints;
```

### Runtime: Convex-Integrated Mode

`createCodexHostRuntime` now accepts `convexUrl + chatApi + userId` and internally creates the persistence adapter, default actor, and session:

```ts
const runtime = createCodexHostRuntime({
  convexUrl: "https://...",
  chatApi: { ensureThread, ensureSession, ingestBatch, /* ... */ },
  userId: "demo-user",
});
```

### Frontend: Unified `useCodex()` Hook

`useCodex()` composes chat, token usage (auto-detected from context), and threads (opt-in):

```tsx
const { messages, activity, composer, tokenUsage, threads } = useCodex({
  threadId,
  actorReady: true,
  composer: { onSend: async (text) => { /* ... */ } },
  threads: { list: { query: api.chat.listThreads, args: { actor } } },
});
```

## Architecture

### Surface Manifest Expansion

Added server request and turn management endpoints to `HOST_SURFACE_MANIFEST.runtimeOwned`:

- Mutations: `upsertPendingServerRequest`, `resolvePendingServerRequest`, `acceptTurnSend`, `failAcceptedTurnSend`
- Queries: `listPendingServerRequests`, `listThreadReasoning`

Default features changed to `serverRequests: true, reasoning: true`.

### `createConvexPersistence` Factory

Extracted from example app bridge-helper into a reusable factory:

- Takes `ConvexHttpClient` + `ConvexPersistenceChatApi` references
- Handles session rollover on recoverable ingest errors
- Manages local turn dispatch queue per thread
- Returns `HostRuntimePersistence` adapter

### Delta Merge Optimization

The runtime core's `enqueueIngestDelta()` now automatically merges consecutive `item/agentMessage/delta` events with contiguous cursors, reducing ingest batch sizes.

### React Export Surface

Reduced from 15+ hook exports to 5 primary hooks:

- `useCodex` (unified), `useCodexRuntimeBridge`, `useCodexAccountAuth`, `useCodexThreadState`, `useCodexThreads`
- All types, derive functions, and utilities remain exported
- Internal hooks (`useCodexMessages`, `useCodexChat`, `useCodexTokenUsage`, etc.) still available for internal composition
