---
"@zakstam/codex-local-component": patch
---

Refactor component internals and example hosts to reduce duplication and tighten architecture boundaries.

- Align Convex dependency baseline to `^1.31.7` for the published component package and release smoke host.
- Deduplicate CLI/smoke host protocol parsing and notification/response guards via `apps/shared/protocolPayload.ts`.
- Deduplicate Convex URL resolution in example hosts via `apps/shared/resolveConvexUrl.ts`.
- Simplify approvals pending-list query construction by centralizing shared pagination state.
- Consolidate deletion batch execution flow with shared batch-step runner logic.
- Split ingest module typing into slice-scoped context types (turn/message/approval/stream/checkpoint/session) to reduce monolithic `IngestContext` coupling.
