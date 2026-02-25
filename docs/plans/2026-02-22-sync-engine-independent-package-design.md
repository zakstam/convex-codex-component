# Sync Engine Independent Package Design

Date: 2026-02-22
Status: Approved
Owner: Architecture planning

## Goal

Extract the durable conversation sync pipeline into an independent package that can work with any persistence backend through explicit adapter contracts.

## Scope and Constraints

- Scope: full durable sync pipeline (source lifecycle + job lifecycle + terminal verification), backend-agnostic.
- Compatibility stance: forward-only clean break (no legacy shims).
- Portability target: v1 portability kit (contract + shared policy/state helpers + adapter conformance suite).
- Execution ownership: adapter-owned execution (adapter provides scheduling/locking primitives).
- Must preserve boundary rules:
- External/app/host boundaries use generated component API types.
- Component-internal `_generated/dataModel` types remain internal only.

## Approaches Considered

### 1) Standalone sync package (selected)

Create `@zakstam/codex-sync-engine` with generic contracts, pure lifecycle logic, policy helpers, conformance tests, and an in-memory reference adapter.

- Pros: true independence, clear ownership, strongest portability, clean ADR alignment.
- Cons: one-time cross-package refactor and dependency rewiring.

### 2) Keep sync in core runtime, export toolkit

Keep durable sync internals in `@zakstam/codex-runtime` and export adapter/conformance surfaces.

- Pros: less initial file movement.
- Cons: weak independence and heavier core package.

### 3) Keep sync mostly Convex-owned

Keep durable sync logic in `@zakstam/codex-runtime-convex` and provide thin generic wrappers.

- Pros: smallest short-term diff.
- Cons: portability is weak and architecture remains backend-coupled.

## Recommendation (Canonical Format)

- Recommendation
  - Introduce a new independent package `@zakstam/codex-sync-engine` and move durable sync lifecycle semantics into it, with backend adapters implementing explicit contracts.
- Why now
  - Durable sync is currently functionally backend-agnostic but structurally tied to Convex-facing surfaces. Extracting now prevents future coupling and repeated refactors as new persistence packages are added.
- Simplicity impact
  - Runtime code depends on one clear sync contract; backend specifics stay in adapters.
- Maintenance impact
  - Shared conformance suite reduces drift and regression risk across adapters.
- Scalability impact
  - New persistence packages can implement the adapter contract without editing runtime core sync logic.
- Evidence
  - Runtime already consumes sync via persistence methods (`startConversationSyncSource`, `appendConversationSyncSourceChunk`, `sealConversationSyncSource`, `getConversationSyncJob`, `waitForConversationSyncJobTerminal`).
  - Convex adapter currently maps these methods directly, indicating clear extraction seams.
- Required dependent updates
  - `@zakstam/codex-runtime`: depend on `@zakstam/codex-sync-engine` contracts/helpers.
  - `@zakstam/codex-runtime-convex`: implement new sync-engine adapter contract and pass conformance tests.
  - Example apps and host shim tooling: update imports/contracts if any sync type paths move.
- Required docs updates
  - Runtime README/API docs and canonical integration docs must describe sync-engine package ownership and adapter contract boundaries.
  - Architecture docs should reflect the new package map.
- Cleanup required
  - Remove duplicated/obsolete sync logic left in runtime or Convex package after extraction; no compatibility aliases.

## Target Architecture

### New package: `@zakstam/codex-sync-engine`

Public surface:
- `contracts`: adapter interfaces and sync domain types.
- `state`: pure source/job lifecycle transitions.
- `policy`: retry/backoff/chunk and validation policy helpers.
- `conformance`: reusable adapter test suite + fixtures.
- `memory`: in-memory reference adapter for tests/dev.

Rules:
- No Convex imports.
- No app-host wrapper assumptions.
- Errors emitted as canonical sync domain errors.

### Runtime integration

- `@zakstam/codex-runtime` calls sync through sync-engine contracts only.
- Runtime remains backend-neutral and does not assume Convex query/mutation behavior.

### Convex integration

- `@zakstam/codex-runtime-convex` provides one adapter implementation of sync-engine contracts.
- Convex-specific function references and host definitions remain package-local.

## Data Flow

1. Runtime starts sync source (`createSource`) using adapter contract.
2. Runtime appends immutable chunks (`appendChunk`) with index and metadata.
3. Runtime seals source (`sealSource`) with checksum/manifest expectations.
4. Adapter-owned worker claims and runs sync jobs:
- reads chunk,
- applies sync-engine state/policy validation,
- persists progress/retry/error,
- commits terminal state.
5. Runtime polls/awaits terminal via adapter contract (`getJob`/`waitForTerminal`).

## Error Handling

- Fail-closed defaults across all adapters.
- Canonical sync error family lives in sync-engine package.
- Adapters map backend-specific failures to canonical sync errors.
- Runtime handles canonical sync errors only.

## Testing Strategy

Conformance suite in sync-engine package must validate:
- Immutable chunk semantics.
- Seal invariants (contiguous chunk indexes, checksum checks, expected counts).
- Retry/backoff transitions.
- Terminal verification and cancellation behavior.

Adapter obligations:
- Convex adapter must pass sync-engine conformance tests.
- In-memory adapter acts as portability reference implementation.

Runtime obligations:
- Runtime tests assert contract-level sync behavior, not backend-specific implementation details.

## Rollout Plan (High-Level)

1. Create `@zakstam/codex-sync-engine` with contracts/state/policy/errors.
2. Add conformance test harness + in-memory adapter.
3. Refactor Convex adapter to implement sync-engine contracts.
4. Rewire runtime durable sync to consume sync-engine contracts/helpers.
5. Remove obsolete sync logic and stale types.
6. Update docs/examples/host-shim checks as required.
7. Add changeset for user-facing package impact (published package policy).

## Out of Scope

- Introducing SQL/document-store production adapters in this change.
- Changing conversation-scoped host contract boundaries.
- Adding backward-compatibility layers or legacy toggles.
