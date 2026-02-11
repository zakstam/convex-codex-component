# Runtime-Owned Reference Host (v0.5)

This is the canonical host pattern when you want the runtime to own dispatch orchestration.

## Runtime mode

Start runtime with explicit runtime-owned orchestration:

```ts
await runtime.start({
  actor,
  sessionId,
  dispatchManaged: false,
  threadStrategy: "start",
});
```

In this mode:

- `runtime.sendTurn(...)` is the only turn-start API.
- `runtime.startClaimedTurn(...)` is invalid (`E_RUNTIME_DISPATCH_MODE_CONFLICT`).

## Convex wrapper surface

Your host `convex/chat.ts` should expose:

- `enqueueTurnDispatch`
- `claimNextTurnDispatch`
- `markTurnDispatchStarted`
- `markTurnDispatchCompleted`
- `markTurnDispatchFailed`
- `cancelTurnDispatch`
- `getTurnDispatchState`
- `getDispatchObservability`
- ingest/session/thread helpers (`ensureSession`, `ingestBatch`, `ensureThread`)

Use `@zakstam/codex-local-component/host/convex` wrapper helpers with generated Convex types.

## Runtime-owned flow

Queue and execute through runtime only:

```ts
async function submitTurn(text: string) {
  await runtime.sendTurn(text);
}
```

Runtime handles enqueue/claim/start/complete internally in this mode.
The claim and mark mutations above are still required because runtime uses them through the host persistence layer.

## Expected logs/state progression

For one successful turn:

1. `sendTurn` accepted by runtime
2. runtime enqueues dispatch -> `queued`
3. runtime claims dispatch -> `claimed`
4. runtime starts turn -> `started`
5. runtime emits `turn/completed` -> `completed`

For failure:

1. `sendTurn` accepted
2. dispatch moves `queued` -> `claimed`
3. runtime emits `error` or failed `turn/completed` -> `failed` with reason code

Use `getDispatchObservability` for one-query diagnosis of queue + claim + runtime + turn correlations.

## Guardrails

- Do not run external claim loops (`claimNextTurnDispatch`) for the same runtime instance.
- If you need external worker ownership, switch to `dispatchManaged: true` and follow `DISPATCH_MANAGED_REFERENCE_HOST.md`.
