# Runtime-Owned Reference Host

Canonical default: runtime-owned host integration.

Use `../LLMS.md` for the normative implementation sequence.
This file is a focused runtime-owned behavior reference.

## Actor Scope Contract

Use `actor: { userId?: string }` when starting runtime and calling host wrappers.
Identified `userId` values are user-scoped; omitted `userId` is anonymous-scoped.

## Runtime Mode

```ts
await runtime.start({
  actor,
  sessionId,
  threadStrategy: "start",
});
```

In this mode:

- `await runtime.sendTurn(...)` durably accepts turns before returning.

## Host Surface Expectations

Runtime-owned wrappers include ingest/session and hook query endpoints.
Define these in `convex/chat.ts` via `defineRuntimeOwnedHostEndpoints(...)`.
Optional app-specific additions can live in `convex/chat.extensions.ts` and be re-exported from `convex/chat.ts`.

## Expected Progression

Successful turn path:

1. `sendTurn` accepted.
2. Runtime emits `turn/completed`.

Failure path:

1. `sendTurn` accepted.
2. Runtime emits failure event or start failure.
3. Runtime reconciles accepted turn to explicit terminal state.
