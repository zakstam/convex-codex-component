# Thread Identity Resolver Design

Date: 2026-02-21
Status: Approved
Scope: Tauri example + host boundary refactor for thread identity/open behavior

## Summary

We will refactor thread opening into a resolver-first architecture that enforces identity boundaries and eliminates edge-case failures caused by mixing persisted IDs and runtime rollout handles.

Selected product behavior:
- If a user selects a persisted conversation with no local rollout, use auto-rebind.
- Keep conversation handle stable across rebinds.
- Use full rename now (no alias compatibility layer in this refactor).

## Problem

Recent errors (`no rollout found for thread id ...`) are caused by identity confusion across layers:
- persisted Convex identifiers are sometimes sent to runtime resume APIs,
- runtime rollout handles are sometimes treated as persisted identifiers,
- callers duplicate fallback behavior in multiple places.

This creates brittle, divergent edge-case handling and repeated regressions.

## Goals

- Single source of truth for thread-open target resolution.
- Clear identity separation across boundaries.
- Deterministic behavior for missing local rollouts.
- Remove duplicated fallback logic from UI/helper callsites.
- Add explicit diagnostics and test coverage for edge cases.

## Non-goals

- Backwards compatibility shims.
- Cross-app migration of existing field names in unrelated surfaces.
- Broad protocol redesign outside open/resume/rebind flow.

## Canonical Identity Model

- `conversationHandle`: stable user-facing conversation identity used by picker and host public boundary.
- `runtimeThreadHandle`: runtime/local rollout identity used for runtime resume/fork/open operations.
- `persistedThreadId`: internal Convex persistence identifier, never used as runtime resume target.

Boundary contract rules:
- UI uses `conversationHandle` only.
- Helper/runtime open path uses `runtimeThreadHandle` only for resume/fork.
- Persistence internals may use `persistedThreadId`, but it cannot leak into runtime open calls.

## Architecture

### Resolver-first open orchestration

Add a single resolver operation invoked before open:
- `resolve_open_target({ conversationHandle, strategy })`

Returns one of:
- `mode: "resume"` + `runtimeThreadHandle`
- `mode: "rebind"` + `conversationHandle`
- `mode: "start"`

### Open flow

1. User selects `conversationHandle`.
2. Bridge helper calls `resolve_open_target`.
3. Resolver output drives execution:
- `resume`: call runtime open with `runtimeThreadHandle`.
- `rebind`: call runtime start/open new local rollout, then bind it to the existing `conversationHandle`.
- `start`: start a brand-new conversation normally.

### Rebind guarantee

Rebind keeps `conversationHandle` stable while updating runtime mapping. This preserves user-visible continuity and conversation history ownership in Convex.

## Error Handling Policy

- Missing local rollout for known `conversationHandle` is not terminal; resolver returns `mode: "rebind"`.
- Unknown `conversationHandle` remains terminal.
- Rebind must be idempotent.
- Runtime/open path must reject accidental `persistedThreadId` usage.

Structured error codes:
- `E_OPEN_TARGET_NOT_FOUND`
- `E_OPEN_TARGET_REBIND_REQUIRED`
- `E_OPEN_TARGET_RESOLUTION_FAILED`

## Observability

Add one open trace envelope per selection/open attempt:
- selected `conversationHandle`
- resolved `mode`
- runtime handle used/created
- rebind outcome

This provides deterministic debugging for identity mismatches.

## Testing Strategy

### Unit tests

Resolver matrix:
- persisted + local rollout exists -> `resume`
- persisted + no local rollout -> `rebind`
- unknown conversation handle -> error
- new start flow -> `start`

### Integration tests

- Tauri helper selection path always goes through resolver.
- Restart/tool-policy path always goes through resolver.
- Ensure no runtime resume call receives `persistedThreadId`.

### Smoke tests

- Debug harness scenario for persisted conversation with missing local rollout must pass.
- Required repo smoke command remains mandatory.

## Rollout Plan

1. Introduce resolver contract and typed result union.
2. Migrate helper open/restart paths to resolver.
3. Remove duplicated fallback logic from UI/helper callsites.
4. Add structured traces and error codes.
5. Add/adjust tests for resolver matrix and integration paths.
6. Run package CI + required debug harness smoke.

## Risks and Mitigations

- Risk: partial migration leaves mixed identities.
  - Mitigation: enforce compile-time typed resolver result and remove old branches.
- Risk: hidden path still sends persisted IDs to runtime.
  - Mitigation: guard assertions + integration tests around runtime open payload.

## ADR Alignment

- Explicit boundaries and typed contracts at public edges.
- No legacy shim layer.
- Single vertical slice for open behavior (`UI -> helper -> resolver -> runtime/persistence`).
- Simplicity and maintenance prioritized over distributed callsite logic.
