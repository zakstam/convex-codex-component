# Client Helpers and React Hooks

This package now ships a consumer SDK layer:

- `@convex-dev/codex-local-component/client`
- `@convex-dev/codex-local-component/react`

## Client helpers

Import from `@convex-dev/codex-local-component/client`:

- `listMessages`
- `listTurnMessages`
- `listPendingApprovals`
- `respondToApproval`
- `startTurn`
- `interruptTurn`
- `syncStreams`
- `resumeStream`
- `getThreadState`

These are thin wrappers around component function references and keep generated Convex typing end-to-end.

## React hooks

Import from `@convex-dev/codex-local-component/react`:

- `useCodexMessages`
- `useCodexStreamingMessages`
- `useCodexTurn`
- `useCodexThreadState`
- `useCodexApprovals`
- `useCodexInterruptTurn`
- `useCodexAutoResume`
- `useCodexComposer`
- `optimisticallySendCodexMessage`

### `useCodexMessages` query contract

Your host query must accept:

- `threadId`
- `paginationOpts`
- optional `streamArgs`

`streamArgs` shape:

- `{ kind: "list", startOrder?: number }`
- `{ kind: "deltas", cursors: Array<{ streamId: string; cursor: number }> }`

And return:

- a paginated list of durable message docs (`messageId`, `turnId`, `role`, `status`, `text`, `orderInTurn`, timestamps)
- optional `streams` result:
  - `{ kind: "list", streams: Array<{ streamId: string; state: string }> }`
  - `{ kind: "deltas", deltas: Array<{ streamId, cursorStart, cursorEnd, kind, payloadJson }> }`

### Merge behavior

`useCodexMessages` always uses durable rows as the source of truth.
When `stream: true`, stream deltas are overlaid only while durable rows are `streaming`:

- terminal statuses override streaming
- longer/extended streamed text can replace in-progress durable text
- dedupe key preference:
  - `(turnId, messageId)`
  - fallback `(turnId, orderInTurn)`

The hook returns `results` in chronological order (`oldest -> newest`) and mirrors `usePaginatedQuery` controls.

## Optimistic send

`optimisticallySendCodexMessage` inserts:

- an optimistic user message row
- optional assistant `streaming` placeholder bound to the same turn

Use it in Convex optimistic updates with the same paginated query used by `useCodexMessages`.

## Approvals hook

`useCodexApprovals` intentionally stays separate from message/thread hooks.

- subscriptions: pending approvals list (paginated)
- actions: `accept(args)` and `decline(args)` mapped to your host approval mutation

This keeps approval lifecycle UX decoupled from message rendering concerns.

## Additional hooks

- `useCodexStreamingMessages`: stream-only materialized overlay for lightweight live transcript views.
- `useCodexTurn`: focused turn-level view from `threadId + turnId`.
- `useCodexInterruptTurn`: interrupt mutation wrapper with optional optimistic interruption of in-flight rows.
- `useCodexAutoResume`: auto-resume stream deltas from a cursor, with local reset fallback (`resetToDurable`).
- `useCodexComposer`: composer state + send helpers for starting turns with generated `turnId` and `idempotencyKey`.
