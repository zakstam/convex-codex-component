# Codex Local Convex Component (v1)

Local-first Convex component for Codex integrations where Codex runs on the user's machine (desktop/CLI).

## What this package contains

- Convex component scaffold (`src/component`) with:
  - Thread and turn lifecycle APIs
  - Stream/session sync APIs
  - Approval workflow APIs
  - Internal scheduler-driven execution hooks
- Local adapter skeleton (`src/local-adapter`) to manage `codex app-server` over stdio
- Typed protocol parsing boundary (`src/protocol`) with `unknown` only at wire ingress

## Runtime handling contract (no fallbacks)

The local bridge requires three handlers:

- `onEvent`: receives thread-scoped normalized events (must have `threadId`).
- `onGlobalMessage`: receives protocol-valid non-thread messages (auth updates, config notices, etc).
- `onProtocolError`: receives malformed JSON, schema violations, or thread-scoped messages missing `threadId`.

Thread-scoped messages without a `threadId` are treated as hard protocol errors.

## Sync ingest error codes

`codex.sync.pushEvents` now throws explicit errors (no silent dedupe/reorder):

- `E_SYNC_EMPTY_BATCH`
- `E_SYNC_SESSION_NOT_FOUND`
- `E_SYNC_SESSION_THREAD_MISMATCH`
- `E_SYNC_SESSION_DEVICE_MISMATCH`
- `E_SYNC_INVALID_CURSOR_RANGE`
- `E_SYNC_OUT_OF_ORDER`
- `E_SYNC_DUP_EVENT_IN_BATCH`
- `E_SYNC_DUP_EVENT_PERSISTED`
- `E_SYNC_REPLAY_GAP`

## Integration assumptions

- Host app handles authentication and authorization.
- Caller provides trusted `tenantId`, `userId`, and `deviceId`.
- Codex auth/session stays local to the user machine.

## Additional docs

- `docs/HOST_INTEGRATION.md`
- `docs/OPERATIONS_AND_ERRORS.md`
- `docs/CLIENT_AND_REACT_HOOKS.md`

## Consumer SDK exports

- `@zakstam/codex-local-component/client`: framework-agnostic typed helpers for messages, approvals, turns, sync, and thread state.
- `@zakstam/codex-local-component/react`: React hooks for messages (`durable + stream` or stream-only), turn-focused reads, separate approvals handling, interrupt/resume/composer flows, thread state reads, and optimistic sends.

## Convex install pattern

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

## Release automation

Releases are automated with Changesets from the monorepo root:

1. Add a changeset in PRs that affect this package (`pnpm changeset`).
2. After merge to `main`, CI opens/updates a version PR.
3. The version PR auto-merges when checks pass.
4. Merge to `main` publishes `@zakstam/codex-local-component` to npm (`latest`).
