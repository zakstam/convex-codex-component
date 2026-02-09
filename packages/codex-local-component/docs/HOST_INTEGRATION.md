# Host Integration Guide

## 1. Install and mount

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

Run `npx convex dev` so `components.codexLocal.*` references are generated.

## 2. Actor trust boundary

Every public API call requires:

- `actor.tenantId`
- `actor.userId`
- `actor.deviceId`

These must be derived from trusted host authentication/session state, not directly from untrusted client input.

## 3. Bridge runner contract

Use `CodexLocalBridge` from a desktop/CLI runtime and provide:

- `onEvent`: persist thread-scoped events via `components.codexLocal.sync.pushEvents`.
- `onGlobalMessage`: handle protocol-valid non-thread messages (telemetry/UI state).
- `onProtocolError`: treat as parse/protocol contract failure; log and recover/restart.

## 4. Minimum ingest wrapper shape

Typical host wrapper flow:

1. Call `sync.heartbeat` with `sessionId`, `threadId`, `lastEventCursor`.
2. Call `sync.pushEvents` with normalized event deltas.
3. Read durable conversation history via `messages.listByThread` / `messages.getByTurn`.
4. Optionally call `sync.pullState`/`sync.resumeFromCursor` for reconnect/replay of active streams.

Optional runtime tuning can be passed on `pushEvents`/`pullState`/`resumeFromCursor`:
- `saveStreamDeltas` (default `false`)
- `maxDeltasPerStreamRead` (default `100`)
- `maxDeltasPerRequestRead` (default `1000`)
- `finishedStreamDeleteDelayMs` (default `300000`)

## 5. Approvals

Approval request events are persisted from:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`

Use `components.codexLocal.approvals.listPending` and `respond` to drive UI.

## 6. Scheduling

The component expects periodic lifecycle cleanup:

- Session stale timeout (`sessions.timeoutStaleSessions`), already triggered from ingest cadence.
- Expired delta cleanup (`streams.cleanupExpiredDeltas`), scheduled from ingest cadence and internally batched.
