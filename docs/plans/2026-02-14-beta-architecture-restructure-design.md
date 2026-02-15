# Beta Architecture Restructure Design

Date: 2026-02-14
Status: Approved
Goal: Prepare @zakstam/codex-local-component for beta/GA by reducing complexity, consolidating the API surface, and removing unused code paths.

## Motivation

The project is transitioning from alpha to beta. This is the last opportunity to make breaking structural changes before the API surface is locked. The audit identified several complexity vectors that should be addressed now.

## Constraints

- Full breaking-change freedom (alpha stage, no backward compat required)
- Simplicity > Maintenance > Scalability (ADR-20260210)
- Vertical slices must stay intact (ADR-20260210)
- Generated Convex types must be used at all boundaries

## What Stays Unchanged

### Schema (18 tables)
Each table separation is justified by distinct lifecycles, authorization patterns, or query requirements. No strong merge candidates.

One cleanup: remove the unused `codex_stream_deltas_ttl::userScope` index (all queries use the more specific `userScope_streamId_eventId` index).

### Ingest Pipeline (12 stages)
The normalize-apply-finalize flow is well-structured. Each stage is justified: sorting for causality, per-event loop with state cache, batched finalization, session maintenance. No structural changes needed.

## Changes

### 1. Remove Dispatch-Managed Mode

The dispatch-managed host mode is non-canonical (runtime-owned is the documented default), adds ~70KB of code, and increases the surface area significantly. Remove it entirely.

**Delete:**
- All dispatch-specific wrappers in `src/host/convexSlice.ts` (enqueueTurnDispatchForActor, claimNextTurnDispatchForActor, markTurnDispatchStartedForActor, markTurnDispatchCompletedForActor, markTurnDispatchFailedForActor, cancelTurnDispatchForActor, getTurnDispatchStateForActor, dispatchObservabilityForActor)
- `defineDispatchManagedHostEndpoints()` and `defineDispatchManagedHostSlice()` from `src/host/convexPreset.ts`
- `src/client/dispatch.ts` (all 7 passthrough functions)
- `src/component/dispatch.ts` (dispatch queue mutations/queries)
- `codex_turn_dispatches` table and its indexes from schema
- Dispatch-related validators (vHostDispatchStatus, vHostDispatchObservability, vHostEnqueueTurnDispatchResult, vHostClaimedTurnDispatch, vHostTurnDispatchState)
- `test/host-convex-slice.test.mjs`
- `dispatchManaged` profile from `src/host/surfaceManifest.ts`
- `docs/DISPATCH_MANAGED_REFERENCE_HOST.md`

**Keep:**
- Runtime-owned turn flow (startTurn, interruptTurn, deleteTurnCascade)
- `codex_turns` table (turns are logical units, independent of dispatch)
- `defineRuntimeOwnedHostEndpoints()` / `defineRuntimeOwnedHostSlice()`

### 2. Eliminate Client Layer

The client layer (`src/client/*.ts`) is 100% mechanical passthrough. Every function just calls `ctx.runQuery(component.xxx, args)` or `ctx.runMutation(component.xxx, args)` with no validation, transformation, or type redefinition.

**Actions:**
- Move `src/client/types.ts` to a shared location (e.g., `src/shared/types.ts`)
- Delete all `src/client/*.ts` passthrough files (threads.ts, turns.ts, messages.ts, approvals.ts, serverRequests.ts, sync.ts, reasoning.ts, dispatch.ts)
- Remove `./client` export path from package.json
- Update the one external consumer (`test-app/convex/persistence.ts`) to use host or generated API
- Update internal imports (mapping.ts, react/, host/) to use shared types location

### 3. Consolidate Export Paths (11 to 7)

**Remove:**
- `./client` (eliminated in step 2)
- `./errors` (fold into default export; already re-exported from `.`)
- `./bridge` (fold into `./host`; bridge is host-side infrastructure)
- `./app-server` (fold into `./host`; app-server client is host-side infrastructure)

**Keep (7 paths):**
| Path | Purpose | Why separate |
|------|---------|-------------|
| `.` | Default: host runtime + mapping + errors + shared types | Every package needs a main entry |
| `./react` | React hooks | Optional peer dep (React) |
| `./react-integration` | Adapter factory for existing Convex apps | Optional adapter pattern |
| `./protocol` | Protocol schemas + parser + classifier | Actively changes with upstream; forbidden in Convex; has ajv dep |
| `./host` | Host runtime + local bridge + app-server client | Non-Convex server-side code |
| `./host/convex` | Convex-safe exports only | Only safe import for convex/ server files |
| `./convex.config` | Component mount | Convex convention |

### 4. Split Oversized Files (>20KB)

| File | Size | Proposed Split |
|------|------|---------------|
| `src/host/runtime.ts` | 68KB | `runtime.ts` (core), `runtimeTurnFlow.ts`, `runtimeSideChannels.ts`, `runtimeEventHandlers.ts` |
| `src/host/convexPreset.ts` | 36KB (shrinks after dispatch removal) | If still >20KB: `convexPreset.ts` (factory), `presetMutations.ts`, `presetQueries.ts` |
| `src/react/useCodexChat.ts` | 38KB | `useCodexChat.ts` (orchestration), `chatState.ts`, `chatEffects.ts` |
| `src/react/useCodexConversationController.ts` | 29KB | `useCodexConversationController.ts` (orchestration), `conversationState.ts`, `conversationActions.ts` |
| `src/component/deletionInternal.ts` | 25KB | `deletionInternal.ts` (orchestrator), `deletionCascade.ts` (per-table logic) |
| `src/host/convexSlice.ts` | 37KB (shrinks after dispatch removal) | If still >20KB: `convexSlice.ts` (shared infra), `sliceQueries.ts`, `sliceMutations.ts` |

Exact splits will be refined during implementation based on actual cohesion boundaries after dispatch removal.

### 5. Simplify React Hook Surface (~20 to ~14 exported hooks)

**Remove (unused by composites, reimplemented internally):**
- `useCodexComposer` — controller reimplements with direct useState
- `useCodexApprovals` — controller reimplements with direct useState
- `useCodexInterruptTurn` — controller reimplements with direct useState
- `useCodexAutoResume` — not used by either composite

**Internalize (not exported, used only by useCodexChat):**
- `useCodexConversationController` — make internal to useCodexChat, remove from public exports

**Keep as building blocks:**
- `useCodexMessages`, `useCodexThreadState`, `useCodexDynamicTools` (core data/interaction hooks)
- `useCodexReasoning`, `useCodexStreamingMessages`, `useCodexStreamingReasoning` (data hooks)
- `useCodexRuntimeBridge`, `useCodexAccountAuth`, `useCodexThreads`, `useCodexTurn` (lifecycle/management hooks)
- `useCodexChat` (primary composite entry point)
- `useCodexTokenUsage`, `useCodexThreadActivity`, `useCodexIngestHealth`, `useCodexBranchActivity` (query wrappers)
- All `derive*` utilities (pure functions)

### 6. Host Layer Cleanup

**Deduplicate index.ts and convex-entry.ts:**
- `convex-entry.ts` becomes the source of truth for Convex-safe exports
- `index.ts` re-exports from `convex-entry.ts` plus runtime, bridge, app-server exports
- No more near-identical file content

**Remove dispatch artifacts from:**
- `surfaceManifest.ts` (single profile only)
- All v* validators related to dispatch

### 7. Additional Cleanups

**Schema:**
- Remove unused `codex_stream_deltas_ttl::userScope` index

**Documentation updates:**
- `LLMS.md` — update consumer path (no more `/client`)
- `API_REFERENCE.md` — reflect new export paths
- `HOST_INTEGRATION.md` — remove dispatch-managed references
- `CLIENT_AND_REACT_HOOKS.md` — update hook list, remove deleted hooks
- `OPERATIONS_AND_ERRORS.md` — remove dispatch error codes
- Delete `DISPATCH_MANAGED_REFERENCE_HOST.md`

**Example updates:**
- `persistent-cli-app` — update imports
- `cli-app` — update imports
- `tauri-app` — update imports
- `release-smoke-host` — update tarball verification for new export paths
- `test-app` — replace `/client` import

**CI updates:**
- `check-mount-imports.mjs` — update for new export paths
- `check-docs-single-path.mjs` — same
- `check-api-reference-useful.mjs` — same
- Remove dispatch-managed test file

**Changeset:**
- Create `minor` changeset for `@zakstam/codex-local-component`

## Execution Order

1. Remove dispatch-managed mode (biggest change, unblocks everything)
2. Eliminate client layer
3. Consolidate export paths
4. Split oversized files
5. Simplify React hooks
6. Host layer deduplication
7. Documentation + examples + CI updates
8. Changeset

## Risk Assessment

| Area | Risk | Mitigation |
|------|------|-----------|
| Dispatch removal | Low | Non-canonical, well-isolated |
| Client elimination | Low | 100% passthrough, one external consumer |
| Export consolidation | Medium | Must update all examples and docs |
| File splitting | Low | Internal refactor, no API change |
| Hook removal | Low | Unused hooks, no external consumers |
| Example updates | Medium | Multiple apps to update simultaneously |

## Success Criteria

- All CI checks pass (`pnpm component:ci`)
- All example apps typecheck
- Smoke host passes
- No `/client` imports remain
- No dispatch-managed references remain
- All files under 20KB (or split with clear rationale)
- Export paths reduced to 7
- React hook exports reduced to ~14
