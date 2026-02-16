# Host Preset Matrix

Canonical source for host preset surfaces.

## Presets

| Preset builder | Profile | Ingest mode | Thread contract | Intended host |
| --- | --- | --- | --- | --- |
| `defineRuntimeOwnedHostEndpoints` | `runtimeOwned` | `streamOnly` | single-path `ensureThread` resolve contract | Runtime-owned orchestration |

## Deterministic query surface

The runtime-owned preset builder includes:

- `validateHostWiring`
- `threadSnapshot`
- `threadSnapshotSafe`
- `persistenceStats`
- `durableHistoryStats`
- `dataHygiene`
- `listThreadMessagesForHooks`
- `listTurnMessagesForHooks`
- `listPendingApprovalsForHooks`
- `listTokenUsageForHooks`

## Deterministic mutation surface

The runtime-owned preset builder includes:

- `ensureThread`
- `ensureSession`
- `ingestEvent`
- `ingestBatch`
- `respondApprovalForHooks`
- `upsertTokenUsageForHooks`
- `interruptTurnForHooks`

`ensureThread` contract:

- Accepts either `threadId` or `externalThreadId` (at least one required).
- Resolves through a single deterministic path (no mode branching).
- Returns canonical persisted `threadId` plus optional external mapping metadata.

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
