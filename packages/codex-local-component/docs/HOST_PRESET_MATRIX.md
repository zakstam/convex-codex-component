# Host Preset Matrix

Canonical source for host preset surfaces.

## Presets

| Preset builder | Profile | Ingest mode | Thread mode | Intended host |
| --- | --- | --- | --- | --- |
| `defineRuntimeOwnedHostEndpoints` | `runtimeOwned` | `streamOnly` | `create` | Runtime-owned orchestration |

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
