# Operations and Error Catalog

This file is operational follow-up for the canonical integration baseline in `../README.md` and `HOST_INTEGRATION.md`.

## Error catalog

### Host runtime dispatch boundary

- `E_RUNTIME_DISPATCH_MODE_REQUIRED`: `start()` called without explicit `dispatchManaged`.
- `E_RUNTIME_DISPATCH_MODE_CONFLICT`: runtime API used in the wrong dispatch mode (`sendTurn` vs `startClaimedTurn`).
- `E_RUNTIME_DISPATCH_EXTERNAL_CLAIM_ACTIVE`: runtime-owned enqueue attempted while external claimed dispatch is active.
- `E_RUNTIME_DISPATCH_TURN_IN_FLIGHT`: new dispatch execution requested while turn is active.
- `E_RUNTIME_DISPATCH_CLAIM_INVALID`: claimed-turn payload missing required ownership fields.

### Authorization

- `E_AUTH_THREAD_FORBIDDEN`: actor cannot access target thread.
- `E_AUTH_TURN_FORBIDDEN`: actor cannot access target turn or turn/thread pairing is invalid.
- `E_AUTH_SESSION_FORBIDDEN`: actor cannot access target session.

### Sync ingest

- `E_SYNC_EMPTY_BATCH`: `sync.ingest` called with no events.
- `E_SYNC_SESSION_NOT_FOUND`: unknown `sessionId`.
- `E_SYNC_SESSION_THREAD_MISMATCH`: session/thread mismatch.
- `E_SYNC_SESSION_DEVICE_MISMATCH`: actor device mismatch.
- `E_SYNC_INVALID_CURSOR_RANGE`: invalid `cursorStart/cursorEnd`.
- `E_SYNC_OUT_OF_ORDER`: cursor start is behind stream latest cursor.
- `E_SYNC_DUP_EVENT_IN_BATCH`: duplicate `eventId` within one ingest call.

For host wrappers, prefer `sync.ingestSafe`:

- Returns `status: ok | partial | session_recovered | rejected`
- Exposes normalized `errors[]` with recoverable classification
- Can self-heal session mismatches via `ensureSession` semantics

Ingest now coalesces message updates within a batch and flushes durable writes once
per message before terminal turn finalization. Terminal events still force durable
end-state persistence in the same ingest cycle.

## Replay behavior

Replay is status-driven, not exception-driven.

`sync.replay` / `sync.resumeReplay` report per-stream status in `streamWindows`:

- `ok`: request served normally.
- `rebased`: requested cursor was behind retained window; replay started at earliest retained cursor.
- `stale`: requested cursor has no useful replay window; consumer should rely on durable state and move to returned checkpoint.

## Retry guidance

- Safe retry after correcting payload: `E_SYNC_EMPTY_BATCH`, `E_SYNC_INVALID_CURSOR_RANGE`, `E_SYNC_OUT_OF_ORDER`, `E_SYNC_DUP_EVENT_IN_BATCH`.
- Retry with corrected identity/context: `E_AUTH_*`, `E_SYNC_SESSION_*`.
- For replay recovery, follow `nextCheckpoints` and persist via `sync.upsertCheckpoint`.

## Runbook notes

### Dispatch queue lifecycle

Use `dispatch.getTurnDispatchState` (or host wrapper equivalent) as the canonical source of send/execution state:

- `queued`: accepted and awaiting claim
- `claimed`: worker ownership acquired with active lease
- `started`: runtime accepted turn execution
- `completed`: terminal success
- `failed`: terminal failure with explicit reason/code
- `cancelled`: explicit cancellation

If a message send is accepted, dispatch state should exist immediately at `queued` minimum.
For single-endpoint diagnosis, prefer host `dispatchObservabilityForActor` projection over multiple ad-hoc queries.

### Dispatch failure modes

1. queued but unclaimed
- check worker availability and `claimNextTurnDispatch` polling cadence
- verify actor/thread identity used by claimer matches enqueuer scope

2. claim lease expired/reclaimed
- expected during worker crash/restart
- verify lease duration and reclaim behavior; a new worker should claim and continue

3. started but no completion
- inspect runtime connectivity and ingest health
- if runtime died after start, mark explicit failure or cancel based on host policy

4. failed with reason taxonomy
- include machine code (`failureCode`) and human reason (`failureReason`)
- use reason codes to distinguish send failures, runtime errors, and policy cancellations

### Pending server-request responses

If command/file approval, `item/tool/requestUserInput`, or `item/tool/call` requests appear stuck:

1. query pending server requests (`components.codexLocal.serverRequests.listPending` or runtime `listPendingServerRequests`)
2. verify request id is still pending for the active turn
3. send typed response via runtime:
   - `respondCommandApproval`
   - `respondFileChangeApproval`
   - `respondToolUserInput`
   - `respondDynamicToolCall`
   - `respondChatgptAuthTokensRefresh` (for `account/chatgptAuthTokens/refresh` global requests)
4. if turn already completed/failed, request may be marked `expired`

### Protocol parse failures

If `onProtocolError` fires:

1. Log raw line and parse error.
2. Restart bridge process.
3. Re-establish session via `sync.heartbeat`.
4. Resume with `sync.replay` using persisted checkpoints.

### Stale sessions

Symptoms:

- session transitions to `stale`
- ingest rejects due to session mismatch/not found

Actions:

1. Start/rebind session with `sync.ensureSession`.
2. Continue ingest.
3. Replay from latest checkpoints.
