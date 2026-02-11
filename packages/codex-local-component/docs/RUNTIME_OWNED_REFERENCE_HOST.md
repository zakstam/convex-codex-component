# Runtime-Owned Reference Host

Canonical default: runtime-owned host integration (`dispatchManaged: false`).

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
  dispatchManaged: false,
  threadStrategy: "start",
});
```

In this mode:

- `runtime.sendTurn(...)` starts turns.
- `runtime.startClaimedTurn(...)` is invalid (`E_RUNTIME_DISPATCH_MODE_CONFLICT`).

## Host Surface Expectations

Runtime-owned generated wrappers include dispatch lifecycle, ingest/session, and hook query endpoints.
Keep these files split:

- `convex/chat.generated.ts` (generated preset surface)
- `convex/chat.extensions.ts` (app-specific additions)
- `convex/chat.ts` (stable re-export entrypoint)

## Expected Progression

Successful turn path:

1. `sendTurn` accepted.
2. Dispatch progresses through queue/claim/start.
3. Runtime emits `turn/completed`.
4. Dispatch terminal state is `completed`.

Failure path:

1. `sendTurn` accepted.
2. Runtime emits failure event.
3. Dispatch terminal state is `failed` with code/reason.

Use `getDispatchObservability` for single-query diagnosis.

## Advanced Appendix (Non-Default)

If explicit external dispatch ownership is required, use:

- `DISPATCH_MANAGED_REFERENCE_HOST.md`
