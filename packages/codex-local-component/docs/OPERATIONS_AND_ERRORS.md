# Operations and Error Catalog

Canonical default: runtime-owned host integration (`dispatchManaged: false`).

This is an operations/runbook companion to `../LLMS.md`.

## Runtime Boundary Errors

- `E_RUNTIME_DISPATCH_MODE_REQUIRED`: runtime started without explicit dispatch mode.
- `E_RUNTIME_DISPATCH_MODE_CONFLICT`: runtime API used in the wrong mode for current startup config.
- `E_RUNTIME_DISPATCH_TURN_IN_FLIGHT`: attempted to start another turn while one is active.
- `E_RUNTIME_DISPATCH_CLAIM_INVALID`: claimed-turn payload was invalid.
- `E_RUNTIME_PROTOCOL_EVENT_INVALID`: incoming event payload was malformed or inconsistent with required runtime shape.
- `E_RUNTIME_INGEST_FLUSH_FAILED`: queued ingest flush failed and was surfaced explicitly.

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
2. Start runtime with `dispatchManaged: false`.
3. Ensure one active turn at a time (`turnInFlight` guard).
4. On protocol errors, restart bridge runtime and rebind session.
5. On stale/missing session errors, call `sync.ensureSession` then continue ingest.

## Pending Request Runbook

When pending server requests accumulate:

1. List pending requests.
2. Confirm request id is still pending.
3. Respond through the matching runtime response API.
4. If turn already ended, treat request as expired.

## Advanced Appendix (Non-Default)

Dispatch-managed orchestration operations are documented separately:

- `DISPATCH_MANAGED_REFERENCE_HOST.md`
