# Dispatch-Managed Reference Host (Advanced Appendix, Non-Default)

This guide is not the canonical consumer path.
Use it only when dispatch-managed orchestration is explicitly requested.

Canonical default remains runtime-owned in `../LLMS.md`.

## Actor Scope Contract

Dispatch-managed mode uses the same actor contract: `actor: { userId?: string }`.
Identified `userId` values are user-scoped; omitted `userId` is anonymous-scoped.

## Runtime Mode

Start runtime with explicit external ownership:

```ts
await runtime.start({
  actor,
  sessionId,
  dispatchManaged: true,
  threadStrategy: "start",
});
```

In this mode:

- `runtime.sendTurn(...)` is invalid (`E_RUNTIME_DISPATCH_MODE_CONFLICT`).
- Turns execute through `runtime.startClaimedTurn(...)`.

## Expected Host Surface

Expose dispatch-managed queue and claim endpoints from host wrappers:

- `enqueueTurnDispatch`
- `claimNextTurnDispatch`
- `markTurnDispatchStarted`
- `markTurnDispatchCompleted`
- `markTurnDispatchFailed`
- `cancelTurnDispatch`
- `getDispatchObservability`

## Sidecar Claim Loop Sketch

```ts
async function drainClaimedDispatches() {
  if (runtime.getState().turnInFlight) return;

  const claimed = await convex.mutation(api.chat.claimNextTurnDispatch, {
    actor,
    threadId: localThreadId,
    claimOwner: `host-claim-${process.pid}`,
  });
  if (!claimed) return;

  await runtime.startClaimedTurn({
    dispatchId: claimed.dispatchId,
    claimToken: claimed.claimToken,
    turnId: claimed.turnId,
    inputText: claimed.inputText,
    idempotencyKey: claimed.idempotencyKey,
  });
}
```
