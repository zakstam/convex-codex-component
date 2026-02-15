# Operations and Error Catalog

Canonical default: runtime-owned host integration.

This is an operations/runbook companion to `../LLMS.md`.

## Runtime Boundary Errors

- `E_RUNTIME_DISPATCH_TURN_IN_FLIGHT`: attempted to start another turn while one is active.
- `E_RUNTIME_PROTOCOL_EVENT_INVALID`: incoming event payload was malformed or inconsistent with required runtime shape.
- `E_RUNTIME_INGEST_FLUSH_FAILED`: queued ingest flush failed and was surfaced explicitly.

`runtime.sendTurn(...)` resolves only after durable accept. If runtime start/send fails after accept, runtime reconciles the accepted turn to a terminal non-streaming state.

Terminal turn artifacts are reconciled through one internal mutation path; avoid app-side/manual split finalization of turns, messages, and streams.
Relationship integrity is reference-first: parent/child tables store Convex `v.id(...)` references (`threadRef`, `turnRef`, `streamRef`) alongside external ids.
Treat these refs as canonical for integrity checks and internal joins; string ids remain protocol-facing identifiers.
Runtime side-channel persistence (`pending server requests`, `token usage`) canonicalizes runtime turn ids to persisted turn ids before writes.
If a side-channel write races ahead of turn persistence, runtime retries briefly with a bounded retry budget instead of surfacing a fatal protocol error.
Legacy `codex/event/*` turn binding accepts explicit `msg.turn_id`/`msg.turnId` only; never derive turn identity from envelope `params.id`.
During ingest normalization, payload-derived turn id is authoritative over incoming envelope `turnId`.
If a legacy event arrives without canonical payload turn id, ingest fails closed with `E_SYNC_TURN_ID_REQUIRED_FOR_CODEX_EVENT` (safe code: `TURN_ID_REQUIRED_FOR_CODEX_EVENT`).
If a `turn/started` or `turn/completed` stream delta arrives without canonical payload turn id, ingest fails closed with `E_SYNC_TURN_ID_REQUIRED_FOR_TURN_EVENT` (safe code: `TURN_ID_REQUIRED_FOR_TURN_EVENT`).
Set `CODEX_BRIDGE_RAW_LOG=all|turns` to print raw `codex app-server` stdout lines before parser/classifier handling (`[codex-bridge:raw-in]`).

## Authorization Errors

- `E_AUTH_THREAD_FORBIDDEN`
- `E_AUTH_TURN_FORBIDDEN`
- `E_AUTH_SESSION_FORBIDDEN`

## Sync Ingest Errors

- `E_SYNC_EMPTY_BATCH`
- `E_SYNC_SESSION_NOT_FOUND`
- `E_SYNC_SESSION_THREAD_MISMATCH`
- `E_SYNC_INVALID_CURSOR_RANGE`
- `E_SYNC_OUT_OF_ORDER`
- `E_SYNC_DUP_EVENT_IN_BATCH`

Use `sync.ingestSafe` in host wrappers so recoverable conditions return structured status instead of hard-failing the loop.
`sync.ensureSession` is forward-only and session-safe: when the session already exists for the same actor but a different thread, it rebinds the session to the requested thread and returns `status: "active"` instead of throwing.
Public classifier utilities are available for consistent host/app fallback handling:

- `parseErrorCode(error)`
- `isThreadMissing(error)`
- `isThreadForbidden(error)`
- `isSessionForbidden(error)`
- `isRecoverableIngestError(errorOrSafeEntry)`

## Terminal Status Parsing Errors

- `E_TERMINAL_PAYLOAD_PARSE_FAILED`: could not decode terminal event payload.
- `E_TERMINAL_MESSAGE_MALFORMED`: terminal message shape was invalid.
- `E_TERMINAL_STATUS_UNEXPECTED`: `turn/completed` carried an unexpected terminal status.
- `E_TERMINAL_ERROR_MISSING`: terminal status/event was missing a required `error.message`.
- `E_TERMINAL_INTERRUPTED`: interrupted terminal status with explicit error details.
- `E_TERMINAL_FAILED`: failed terminal status with explicit error details.

## Replay Recovery

`sync.replay` and `sync.resumeReplay` are status-driven:

- `ok`: replay served normally
- `rebased`: requested cursor was behind retained window
- `stale`: no useful replay window; rely on durable state and next checkpoint

Follow `nextCheckpoints` and persist with `sync.upsertCheckpoint`.

## Startup and Health Runbook

1. Run `chat.validateHostWiring` at startup.
2. Ensure one active turn at a time (`turnInFlight` guard).
4. On protocol errors, restart bridge runtime and rebind session.
5. On stale/missing/mismatched session errors, call `sync.ensureSession` then continue ingest.

## Deletion Job Runbook

Cascade delete APIs are async and job-driven:

- `threads.deleteCascade` -> delete one thread subtree
- `threads.scheduleDeleteCascade` -> schedule one thread subtree delete
- `turns.deleteCascade` -> delete one turn subtree
- `turns.scheduleDeleteCascade` -> schedule one turn subtree delete
- `threads.purgeActorData` -> delete all Codex data in the actor scope
- `threads.schedulePurgeActorData` -> schedule actor-scope purge
- `threads.cancelScheduledDeletion` -> cancel scheduled deletion before execution
- `threads.forceRunScheduledDeletion` -> execute a scheduled deletion immediately

Each mutation returns `{ deletionJobId }`.
Poll `threads.getDeletionJobStatus` until terminal status:

- `queued`
- `scheduled`
- `running`
- `completed`
- `failed`
- `cancelled`

`failed` jobs surface:

- `errorCode` (`E_DELETE_JOB_FAILED`)
- `errorMessage`

The delete worker is idempotent and paged; repeated calls create independent jobs.
Cascade is the default delete behavior for parent scopes (thread and turn targets).

## Pending Request Runbook

When pending server requests accumulate:

1. List pending requests.
2. Confirm request id is still pending.
3. Respond through the matching runtime response API.
4. If turn already ended, treat request as expired.
