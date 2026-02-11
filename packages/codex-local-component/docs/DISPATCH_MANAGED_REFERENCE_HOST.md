# Dispatch-Managed Reference Host (v0.5)

This is the canonical host pattern when you want external dispatch orchestration.

## Runtime mode

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
- turns must execute through `runtime.startClaimedTurn(...)`.

## Convex wrapper surface

Your host `convex/chat.ts` should expose:

- `enqueueTurnDispatch`
- `claimNextTurnDispatch`
- `markTurnDispatchStarted`
- `markTurnDispatchCompleted`
- `markTurnDispatchFailed`
- `cancelTurnDispatch`
- `getDispatchObservability`

Use `@zakstam/codex-local-component/host/convex` wrapper helpers with generated Convex types.

## Sidecar claim loop

```ts
async function drainClaimedDispatches() {
  if (runtime.getState().turnInFlight) return;
  const claimed = await convex.mutation(api.chat.claimNextTurnDispatch, {
    actor,
    threadId: localThreadId,
    claimOwner: actor.deviceId,
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

Queue user input separately:

```ts
await convex.mutation(api.chat.enqueueTurnDispatch, {
  actor,
  threadId: localThreadId,
  dispatchId: randomUUID(),
  turnId: randomUUID(),
  idempotencyKey: randomUUID(),
  input: [{ type: "text", text }],
});
await drainClaimedDispatches();
```

Run `drainClaimedDispatches()` after `turn/completed` and `error` events.

## Expected logs/state progression

For one successful turn:

1. `enqueueTurnDispatch` -> dispatch state `queued`
2. `claimNextTurnDispatch` -> dispatch state `claimed`
3. `startClaimedTurn` accepted -> dispatch state `started`
4. runtime emits `turn/completed` -> dispatch state `completed`

For failure:

1. `enqueueTurnDispatch` -> `queued`
2. `claimNextTurnDispatch` -> `claimed`
3. runtime `error` or failed `turn/completed` -> `failed` with reason code

Use `getDispatchObservability` for one-query diagnosis of queue + claim + runtime + turn correlations.
