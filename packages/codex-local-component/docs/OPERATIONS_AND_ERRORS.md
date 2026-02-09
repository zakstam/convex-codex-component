# Operations and Error Catalog

## Error catalog

### Authorization errors

- `E_AUTH_THREAD_FORBIDDEN`: actor cannot access target thread.
- `E_AUTH_TURN_FORBIDDEN`: actor cannot access target turn or turn/thread pairing is invalid.
- `E_AUTH_SESSION_FORBIDDEN`: actor cannot access target session.

### Sync ingest/replay errors

- `E_SYNC_EMPTY_BATCH`: `pushEvents` called with no deltas.
- `E_SYNC_SESSION_NOT_FOUND`: unknown `sessionId`.
- `E_SYNC_SESSION_THREAD_MISMATCH`: session or turn does not match target thread.
- `E_SYNC_SESSION_DEVICE_MISMATCH`: actor device does not match session device.
- `E_SYNC_INVALID_CURSOR_RANGE`: delta has invalid `cursorStart/cursorEnd`.
- `E_SYNC_OUT_OF_ORDER`: delta start cursor is not the next expected cursor.
- `E_SYNC_DUP_EVENT_IN_BATCH`: duplicate `eventId` inside one ingest batch.
- `E_SYNC_DUP_EVENT_PERSISTED`: duplicate `eventId` already persisted for stream.
- `E_SYNC_REPLAY_GAP`: requested replay cursor is older than retained data, or retained deltas are non-contiguous from requested cursor.

## Retry guidance

- Safe to retry after fixing request: `E_SYNC_EMPTY_BATCH`, `E_SYNC_INVALID_CURSOR_RANGE`, `E_SYNC_OUT_OF_ORDER`, `E_SYNC_DUP_EVENT_IN_BATCH`.
- Retry with corrected identity/context: `E_AUTH_*`, `E_SYNC_SESSION_*`.
- `E_SYNC_DUP_EVENT_PERSISTED` typically indicates caller retrying already-persisted payload; advance cursor/checkpoint first.
- `E_SYNC_REPLAY_GAP` requires a fresh state sync strategy (cannot continue from missing cursor range).

## Runbook notes

### Protocol parse failures

If `onProtocolError` fires:

1. Log raw line and parse error.
2. Stop and restart the bridge process.
3. Re-establish session and replay from latest known cursor.

### Stale sessions

Symptoms:

- session status transitions to `stale`.
- event ingest rejected due to session mismatch/not found.

Actions:

1. Send `heartbeat` on reconnect.
2. Start new session and continue ingest.

### Replay failures (`E_SYNC_REPLAY_GAP`)

Symptoms:

- reconnect replay from old cursor fails.

Actions:

1. Treat local incremental replay as invalid.
2. Request a fresh pull from current retained state/cursors.
3. Reset local per-stream cursor state to returned values.

### Cleanup health

`streams.cleanupExpiredDeltas` runs in bounded batches and self-schedules while work remains.  
If backlog grows, increase invocation frequency or run explicit cleanup jobs from host operations tooling.

