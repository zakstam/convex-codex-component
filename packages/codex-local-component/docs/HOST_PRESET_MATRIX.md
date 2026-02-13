# Host Preset Matrix

Canonical source for host preset surfaces.

## Presets

| Preset helper | Profile | Ingest mode | Thread mode | Intended host |
| --- | --- | --- | --- | --- |
| `defineDispatchManagedHostEndpoints` | `dispatchManaged` | `mixed` | `resolve` | Tauri / externally claimed dispatch |
| `defineRuntimeOwnedHostEndpoints` | `runtimeOwned` | `streamOnly` | `create` | Runtime-owned orchestration |

## Deterministic query surface

All focused preset builders include:

- `validateHostWiring`
- `getTurnDispatchState`
- `getDispatchObservability`
- `threadSnapshot`
- `threadSnapshotSafe`
- `persistenceStats`
- `durableHistoryStats`
- `listThreadMessagesForHooks`
- `listTurnMessagesForHooks`
- `listPendingApprovalsForHooks`
- `listTokenUsageForHooks`

Additional query endpoints:

- Dispatch-managed only: `listThreadReasoningForHooks`, `listPendingServerRequestsForHooks`
- Runtime-owned only: `dataHygiene`

## Deterministic mutation surface

All focused preset builders include:

- `ensureThread`
- `enqueueTurnDispatch`
- `claimNextTurnDispatch`
- `markTurnDispatchStarted`
- `markTurnDispatchCompleted`
- `markTurnDispatchFailed`
- `cancelTurnDispatch`
- `ensureSession`
- `ingestEvent`
- `ingestBatch`
- `respondApprovalForHooks`
- `upsertTokenUsageForHooks`
- `interruptTurnForHooks`

Dispatch-managed additionally includes:

- `upsertPendingServerRequestForHooks`
- `resolvePendingServerRequestForHooks`

## Wiring preflight

Call `validateHostWiring` after deploy/startup to fail fast on component mount drift.

Example:

```ts
await ctx.runQuery(api.chat.validateHostWiring, {
  actor,
});
```

Response shape:

- `ok: boolean`
- `checks: Array<{ name: string; ok: boolean; error?: string }>`

If `ok` is false, one or more required `components.codexLocal.*` paths are not reachable in the current deployment.
