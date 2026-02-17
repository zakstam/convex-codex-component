# External Consumer API Redesign (Task-Oriented, Hard Cut)

Date: 2026-02-17  
Status: Approved design

## Context

The current `api.chat.*` surface in `apps/examples/tauri-app/convex/chat.ts` exposes many endpoints that are understandable internally but high-friction for external consumers.

Recent project work already standardized canonical integration paths and removed broader legacy compatibility, so the next improvement is API ergonomics for external host consumers.

## Goal

Improve external consumer usability by reducing public API surface area and aligning it to user tasks.

## Non-Goals

- No compatibility aliases or legacy endpoint support.
- No mode-branching contracts exposed to consumers.
- No expansion of scope beyond external API shape, contracts, and migration guidance.

## Design Summary

Use a task-oriented public surface under `api.chat.*` with consistent contracts.

### Public Endpoints

- `chat.bootstrap`
- `chat.thread.ensure`
- `chat.thread.get`
- `chat.thread.list`
- `chat.turn.send`
- `chat.turn.interrupt`
- `chat.approval.listPending`
- `chat.approval.respond`
- `chat.data.cleanup`
- `chat.data.cleanupJob`

### Contract Rules

- Actor envelope for scoped operations: `actor: { userId?: string }`.
- Thread targeting uses one discriminated identity object:
  - `{ kind: "threadId", value: string }`
  - `{ kind: "externalThreadId", value: string }`
  - `{ kind: "runtimeThreadId", value: string }`
- Thread handle output is normalized and stable:
  - `threadId`, `status`, `updatedAt`, optional `externalThreadId`, optional `runtimeThreadId`, `linkState`.
- Mutation result envelope:
  - Success: `{ ok: true, data: ... }`
  - Expected failure: `{ ok: false, error: { code, message, retryable } }`
- List result envelope:
  - `{ items, hasMore, cursor }`.

## Data Flow

1. Consumer calls compact task endpoint in `api.chat.*`.
2. Endpoint resolves actor and thread identity once at boundary.
3. Endpoint delegates to runtime-owned codexLocal host component functions.
4. Endpoint maps internals to stable external DTOs.

This keeps external contract stable while preserving internal flexibility.

## Error Handling

Public error codes are constrained to:

- `INVALID_ARGUMENT`
- `NOT_FOUND`
- `ACTOR_MISMATCH`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL`

Boundary handlers map internal exceptions into this taxonomy.

## Cutover Strategy

Hard cut (no legacy path):

- Replace current external `api.chat.*` surface with the new task-oriented API in a single release.
- Provide migration documentation mapping old endpoint names/args to the new surface before release.
- Do not ship aliases or deprecated wrappers.

## Testing and Verification

- Contract tests for every new endpoint request/response shape.
- Contract tests for error envelope mapping and code stability.
- End-to-end smoke flow:
  - bootstrap -> thread.ensure -> turn.send -> approval flow -> cleanup flow.
- CI guard that exported public endpoints match documented API and block undocumented additions.

## Success Criteria

- External API is learnable through a short task-based mental model:
  - bootstrap -> thread -> turn -> approvals -> cleanup.
- New integrations can complete first-message flow with fewer endpoint-specific decisions.
- Public contracts (arguments, envelopes, errors) are consistent across endpoints.
