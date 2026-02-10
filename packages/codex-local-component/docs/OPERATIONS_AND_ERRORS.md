# Operations and Error Catalog

## Error catalog

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
