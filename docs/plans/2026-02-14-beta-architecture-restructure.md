# Beta Architecture Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
 
> Note: Historical plan artifact preserved for implementation context only. Current canonical guidance is in package documentation.

**Goal:** Prepare @zakstam/codex-local-component for beta/GA by removing dispatch-managed mode, eliminating the client passthrough layer, consolidating export paths (11 to 7), splitting oversized files, and simplifying the React hook surface.

**Architecture:** The restructure preserves the core vertical-slice architecture (protocol > component > host > react) while removing the non-canonical dispatch-managed host mode, eliminating the zero-transformation client passthrough layer, and consolidating export paths. Schema and ingest pipeline stay unchanged.

**Tech Stack:** TypeScript, Convex, React, pnpm monorepo, Node.js native test runner

---

## Prerequisites

- Working directory: `codex-convex-component/codex-convex-component/`
- All commands run from: `packages/codex-local-component/` unless noted
- CI command: `pnpm run ci` (typecheck + unsafe-types + error-discipline + test + mount-imports + docs-single-path)
- Full CI: `pnpm -w run ci` (from monorepo root; includes example typechecks)
- Read `CLAUDE.md`, `LLM_WORKFLOW.md`, `ARCHITECTURE_DECISIONS.md` before starting

---

### Task 1: Create working branch and verify green baseline

**Files:**
- None modified

**Step 1: Create branch**

```bash
git checkout -b refactor/beta-architecture-restructure
```

**Step 2: Verify CI passes on main**

```bash
cd packages/codex-local-component && pnpm run ci
```

Expected: All checks pass (typecheck, unsafe-types, error-discipline, test, mount-imports, docs-single-path)

**Step 3: Commit**

No commit needed — baseline verified.

---

### Task 2: Remove dispatch component implementation

**Files:**
- Delete: `src/component/dispatch.ts`
- Modify: `src/component/schema.ts` (remove `codex_turn_dispatches` table)
- Modify: `src/component/deletionInternal.ts` (remove dispatch table cleanup blocks)
- Modify: `src/component/threads.ts` (remove dispatch observability queries)

**Step 1: Delete `src/component/dispatch.ts`**

Remove the entire file. It contains 7 dispatch mutations/queries (569 lines).

**Step 2: Remove `codex_turn_dispatches` from schema**

In `src/component/schema.ts`, remove the `codex_turn_dispatches` table definition (lines 76-113) and its field/index definitions.

**Step 3: Remove dispatch cleanup from deletionInternal.ts**

In `src/component/deletionInternal.ts`, find and remove the three blocks that clean up `codex_turn_dispatches` rows during cascade deletion (around lines 206-213, 393-400, 536-543). Search for `codex_turn_dispatches` to find all references.

**Step 4: Remove dispatch observability from threads.ts**

In `src/component/threads.ts`, find the dispatch observability queries in `getThreadActivity` (around lines 807-866) that query `codex_turn_dispatches` by status (queued, claimed, started, completed, failed, cancelled). Remove these blocks.

**Step 5: Find and remove any remaining `codex_turn_dispatches` references in component/**

```bash
grep -rn "codex_turn_dispatches\|dispatch" src/component/ --include="*.ts"
```

Remove any remaining references. Some files may import from `dispatch.ts` — remove those imports.

**Step 6: Run typecheck to verify**

```bash
pnpm run typecheck
```

Expected: Errors in host/ and client/ (those still reference dispatch). Component layer should be clean.

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor(component): remove dispatch-managed implementation and schema"
```

---

### Task 3: Remove dispatch from client layer

**Files:**
- Delete: `src/client/dispatch.ts`
- Modify: `src/client/index.ts` (remove dispatch exports)

**Step 1: Delete `src/client/dispatch.ts`**

Remove the entire file (78 lines of passthrough wrappers).

**Step 2: Remove dispatch exports from `src/client/index.ts`**

Remove the dispatch export block:
```typescript
export {
  enqueueTurnDispatch,
  claimNextTurnDispatch,
  markTurnStarted,
  markTurnCompleted,
  markTurnFailed,
  cancelTurnDispatch,
  getTurnDispatchState,
} from "./dispatch.js";
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor(client): remove dispatch passthrough wrappers"
```

---

### Task 4: Remove dispatch from host layer

**Files:**
- Modify: `src/host/convexSlice.ts` (remove dispatch functions, types, validators)
- Modify: `src/host/convexPreset.ts` (remove dispatch builders and mutation/query definitions)
- Modify: `src/host/surfaceManifest.ts` (remove dispatchManaged profile)
- Modify: `src/host/index.ts` (remove dispatch exports)
- Modify: `src/host/convex-entry.ts` (remove dispatch exports)

**Step 1: Remove dispatch from convexSlice.ts**

Remove these sections (search by name, line numbers are approximate):
- Type `CodexDispatchComponent` (~lines 317-327)
- Validators: `vHostDispatchStatus` (~127-134), `vHostEnqueueTurnDispatchResult` (~145-150), `vHostClaimedTurnDispatch` (~152-163), `vHostTurnDispatchState` (~165-187), `vHostDispatchObservability` (~189-214)
- Functions: `enqueueTurnDispatchForActor` (~656-671), `claimNextTurnDispatchForActor` (~673-686), `markTurnDispatchStartedForActor` (~688-703), `markTurnDispatchCompletedForActor` (~705-718), `markTurnDispatchFailedForActor` (~720-735), `cancelTurnDispatchForActor` (~737-751), `getTurnDispatchStateForActor` (~753-766), `dispatchObservabilityForActor` (~768-874)
- Remove dispatch-related imports from the client layer import at the top (~line 20)

**Step 2: Remove dispatch from convexPreset.ts**

Remove:
- Dispatch mutation setup blocks: `enqueueTurnDispatch` (~402-433), `claimNextTurnDispatch` (~434-456), `markTurnDispatchStarted` (~457-483), `markTurnDispatchCompleted` (~484-506), `markTurnDispatchFailed` (~507-533), `cancelTurnDispatch` (~534-558)
- Dispatch query setup: `getTurnDispatchState` (~764-786), `getDispatchObservability` (~863-886)
- Builder functions: `defineDispatchManagedHostSlice` (~1133-1157), `defineDispatchManagedHostEndpoints` (~1185-1189)
- Type definitions: `DispatchManagedMutationKeys` (~1085), `DispatchManagedQueryKeys` (~1086), `DispatchManagedHostDefinitions` (~1105-1109), `DefineDispatchManagedHostSliceOptions` (~1117-1119), `DefineDispatchManagedHostEndpointsOptions` (~1125-1127)

**Step 3: Remove dispatch from surfaceManifest.ts**

Remove the `dispatchManaged` entry from `HOST_PRESET_DEFINITIONS` (~lines 2-8) and the `dispatchManaged` profile from `HOST_SURFACE_MANIFEST` mutations (~20-36) and queries (~37-51).

**Step 4: Remove dispatch exports from host/index.ts and host/convex-entry.ts**

Remove all `defineDispatchManaged*`, `DispatchManaged*`, `vHostDispatch*`, `vHostEnqueueTurnDispatch*`, `vHostClaimedTurnDispatch*`, `vHostTurnDispatchState*`, `enqueueTurnDispatchForActor`, `claimNextTurnDispatchForActor`, `markTurnDispatch*ForActor`, `cancelTurnDispatchForActor`, `getTurnDispatchStateForActor`, `dispatchObservabilityForActor` exports from both files.

**Step 5: Verify typecheck**

```bash
pnpm run typecheck
```

Expected: Errors in examples that import dispatch functions. Package itself should be clean.

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(host): remove dispatch-managed mode entirely"
```

---

### Task 5: Remove dispatch from tests and docs

**Files:**
- Modify: `test/host-convex-slice.test.mjs` (remove dispatch test, keep other 9 tests)
- Delete: `docs/DISPATCH_MANAGED_REFERENCE_HOST.md`
- Modify: `scripts/check-docs-single-path.mjs` (remove dispatch references)

**Step 1: Remove dispatch test from host-convex-slice.test.mjs**

Remove the `dispatchObservabilityForActor` test block (~lines 146-197). Keep all other 9 tests (ensureThreadByCreate, ingestBatchMixed, normalizeInboundDeltas, computePersistenceStats, computeDurableHistoryStats, computeDataHygiene, listThreadMessagesForHooks, threadSnapshotSafe, server request tests).

**Step 2: Delete `docs/DISPATCH_MANAGED_REFERENCE_HOST.md`**

Remove the entire file.

**Step 3: Update check-docs-single-path.mjs**

Remove the forbidden patterns for dispatch-managed: `dispatchManaged: true`, `defineDispatchManagedHostSlice`, `startClaimedTurn`. Remove the advanced docs check for `DISPATCH_MANAGED_REFERENCE_HOST.md`. Update the canonical marker check — remove the reference to `dispatchManaged: false` if it's no longer needed (since there's only one mode).

**Step 4: Run CI**

```bash
pnpm run ci
```

Expected: All checks pass (tests, docs, typecheck). Example apps may still fail.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove dispatch tests, docs, and CI dispatch checks"
```

---

### Task 6: Update example apps to remove dispatch usage

**Files:**
- Modify: `apps/examples/tauri-app/convex/chat.ts` (switch from dispatch-managed to runtime-owned)
- Modify: `apps/examples/tauri-app/src-node/bridge-helper.ts` (remove dispatch wrappers)
- Modify: `apps/examples/persistent-cli-app/convex/chat.ts` (remove dispatch exports)
- Modify: `apps/examples/persistent-cli-app/src/index.ts` (remove dispatch usage)
- Modify: `apps/release-smoke-host/convex/chat.ts` (remove dispatch exports if present)
- Modify: `apps/release-smoke-host/src/index.ts` (remove dispatch imports if present)

**Step 1: Update tauri-app convex/chat.ts**

Replace `defineDispatchManagedHostEndpoints` with `defineRuntimeOwnedHostEndpoints`. Remove dispatch mutation exports (enqueueTurnDispatch, claimNextTurnDispatch, etc.).

**Step 2: Update tauri-app bridge-helper.ts**

Remove dispatch wrapper functions. The bridge should use runtime-owned turn flow instead.

**Step 3: Update persistent-cli-app**

In `convex/chat.ts`, remove dispatch mutation exports. In `src/index.ts`, remove dispatch usage and switch to runtime-owned turn submission.

**Step 4: Update release-smoke-host**

Check and remove any dispatch references.

**Step 5: Run full CI from monorepo root**

```bash
cd ../.. && pnpm run ci
```

Expected: All typechecks pass for all apps.

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(examples): migrate all apps from dispatch-managed to runtime-owned"
```

---

### Task 7: Eliminate client passthrough layer

**Files:**
- Create: `src/shared/types.ts` (move types from client/types.ts)
- Delete: `src/client/threads.ts`, `src/client/turns.ts`, `src/client/messages.ts`, `src/client/approvals.ts`, `src/client/serverRequests.ts`, `src/client/sync.ts`, `src/client/reasoning.ts`, `src/client/index.ts`, `src/client/types.ts`
- Modify: `src/index.ts` (remove `export * from "./client/index.js"`)
- Modify: `src/host/convexSlice.ts` (update imports from `../client/index.js` to direct component API)
- Modify: `src/host/convex.ts` (update type imports from `../client/types.js` to `../shared/types.js`)
- Modify: `src/react/useCodexMessages.ts` (update type import from `../client/types.js` to `../shared/types.js`)
- Modify: `src/mapping.ts` (update type import from `./client/types.js` to `./shared/types.js`)
- Modify: `package.json` (remove `./client` export path)

**Step 1: Create `src/shared/types.ts`**

Copy `src/client/types.ts` to `src/shared/types.ts`. Remove dispatch-related types if any remain. This file keeps: `CodexComponent`, `CodexQueryRunner`, `CodexMutationRunner`, `CodexActorContext`, `CodexMessageDoc`, `CodexUIMessage`, `CodexReasoningSegment`, `CodexStreamOverlay`, `CodexSyncRuntimeOptions`, `GenericQueryRef`, `GenericMutationRef`.

**Step 2: Update internal imports**

- `src/mapping.ts` line 1: change `from "./client/types.js"` to `from "./shared/types.js"`
- `src/react/useCodexMessages.ts` line 6: change `from "../client/types.js"` to `from "../shared/types.js"`
- `src/host/convex.ts` line 2: change `from "../client/types.js"` to `from "../shared/types.js"`
- `src/host/convexSlice.ts` line 20: This imports client functions, not just types. The host layer needs to call the component API directly instead of through client wrappers. Since convexSlice.ts already imports the component's generated API, update these to call the component directly (the client functions were just passthrough).

**Step 3: Update `src/index.ts`**

Replace `export * from "./client/index.js"` with `export * from "./shared/types.js"` (export the shared types from the default path).

**Step 4: Delete all `src/client/*.ts` files**

Remove the entire `src/client/` directory.

**Step 5: Remove `./client` from package.json exports**

Remove the `"./client"` entry from the `exports` field.

**Step 6: Verify typecheck** _(archived step)_

```bash
pnpm run typecheck
```

Expected: Clean within the package. External consumers importing from `/client` will fail.

**Step 7: Update external consumer**

In `apps/` find any imports from `@zakstam/codex-local-component/client` and update them. Known: test-app uses `getThreadState` from `/client` — replace with the host or generated API equivalent.  
This guidance is historical context for this migration plan and is not current runtime guidance.

**Step 8: Run tests**

```bash
pnpm run test
```

Expected: All 17 remaining tests pass (dispatch test was removed in Task 5). The old `client-helpers` passthrough test path no longer exists in the current architecture and should be considered deprecated in this plan history.

**Step 9: Commit**

```bash
git add -A && git commit -m "refactor: eliminate client passthrough layer, move types to shared/"
```

---

### Task 8: Consolidate export paths (11 to 7)

**Files:**
- Modify: `package.json` (remove `./errors`, `./bridge`, `./app-server` exports)
- Modify: `src/host/index.ts` (add bridge and app-server re-exports)
- Delete: `src/bridge.ts` (single-line re-export file)
- Modify: `src/index.ts` (ensure errors stay exported from default)
- Modify: `scripts/check-api-reference-useful.mjs` (update section map)
- Modify: `docs/API_REFERENCE.md` (update sections)

**Step 1: Fold `/errors` into default export**

Already re-exported from `src/index.ts` line 4. Just remove the `./errors` entry from `package.json` exports.

**Step 2: Fold `/bridge` into `/host`**

In `src/host/index.ts`, add: `export * from "../local-adapter/bridge.js";`
Delete `src/bridge.ts`.
Remove `./bridge` from `package.json` exports.

**Step 3: Fold `/app-server` into `/host`**

In `src/host/index.ts`, add: `export * from "../app-server/index.js";`
Remove `./app-server` from `package.json` exports.

**Step 4: Update consumers of removed paths** _(legacy migration note)_

Search all apps for imports from these paths:
- `@zakstam/codex-local-component/bridge` used in: `cli-app/src/index.ts`, `persistent-cli-app/src/index.ts`, `release-smoke-host/src/index.ts` — change to `@zakstam/codex-local-component/host`  
  (legacy migration note)
- `@zakstam/codex-local-component/errors` — check if used, update to default import  
  (legacy migration note)
- `@zakstam/codex-local-component/app-server` — check if used, update to `/host`  
  (legacy migration note)

**Step 5: Update check-api-reference-useful.mjs**

Update the section map (lines 8-20) to remove `client`, `errors`, `bridge`, `app-server` entries. The remaining sections should be: `.`, `react`, `react-integration`, `host`, `host/convex`, `protocol`, `convex.config`.

**Step 6: Update API_REFERENCE.md**

Remove sections for the deleted export paths. Move their content to the appropriate remaining sections.

**Step 7: Run CI**

```bash
pnpm run ci
```

Expected: All checks pass.

**Step 8: Run full monorepo CI**

```bash
cd ../.. && pnpm run ci
```

Expected: All example typechecks pass.

**Step 9: Commit**

```bash
git add -A && git commit -m "refactor: consolidate export paths from 11 to 7"
```

---

### Task 9: Deduplicate host/index.ts and host/convex-entry.ts

**Files:**
- Modify: `src/host/index.ts` (re-export from convex-entry.ts instead of duplicating)
- Modify: `src/host/convex-entry.ts` (becomes source of truth for Convex-safe exports)

**Step 1: Make convex-entry.ts the source of truth**

`convex-entry.ts` should export only Convex-safe symbols (validators, actor wrappers, endpoint definers, error classifiers). Review and keep its current content.

**Step 2: Refactor index.ts to re-export from convex-entry.ts**

Replace the duplicated exports with:
```typescript
// Re-export all Convex-safe exports
export * from "./convex-entry.js";

// Additional non-Convex exports (runtime, bridge, app-server)
export { createCodexHostRuntime, ... } from "./runtime.js";
export * from "../local-adapter/bridge.js";
export * from "../app-server/index.js";
```

**Step 3: Verify typecheck**

```bash
pnpm run typecheck
```

**Step 4: Run tests**

```bash
pnpm run test
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(host): deduplicate index.ts by re-exporting from convex-entry.ts"
```

---

### Task 10: Split runtime.ts (68KB)

**Files:**
- Modify: `src/host/runtime.ts` (extract into focused modules)
- Create: `src/host/runtimeTurnFlow.ts`
- Create: `src/host/runtimeSideChannels.ts`
- Create: `src/host/runtimeEventHandlers.ts`

**Step 1: Read runtime.ts and identify cohesion boundaries**

Read the full file. Identify:
- Core class definition, start/stop, state management → stays in `runtime.ts`
- Turn submission, stream handling, terminal detection → `runtimeTurnFlow.ts`
- Pending server requests, token usage, approval coordination → `runtimeSideChannels.ts`
- Event handler dispatch (per-event-type switch/routing) → `runtimeEventHandlers.ts`

**Step 2: Extract runtimeTurnFlow.ts**

Move turn-related methods or functions. Use either:
- Top-level functions that the class calls
- A separate class/mixin pattern

Keep the public API on `CodexHostRuntime` unchanged — internal extraction only.

**Step 3: Extract runtimeSideChannels.ts**

Move side-channel persistence logic (pending requests, token usage).

**Step 4: Extract runtimeEventHandlers.ts**

Move event handler routing/dispatch logic.

**Step 5: Update imports in runtime.ts**

Import the extracted modules.

**Step 6: Verify all files are under 20KB**

```bash
wc -c src/host/runtime.ts src/host/runtimeTurnFlow.ts src/host/runtimeSideChannels.ts src/host/runtimeEventHandlers.ts
```

**Step 7: Run tests**

```bash
pnpm run test
```

Expected: `host-runtime.test.mjs` passes unchanged (no public API change).

**Step 8: Commit**

```bash
git add -A && git commit -m "refactor(host): split runtime.ts into focused modules"
```

---

### Task 11: Split React hook files (useCodexChat.ts 38KB, useCodexConversationController.ts 29KB)

**Files:**
- Modify: `src/react/useCodexChat.ts` (extract state and effects)
- Create: `src/react/chatState.ts`
- Create: `src/react/chatEffects.ts`
- Modify: `src/react/useCodexConversationController.ts` (extract state and actions)
- Create: `src/react/conversationState.ts`
- Create: `src/react/conversationActions.ts`

**Step 1: Read both files and identify split points**

For `useCodexChat.ts`:
- Tool management state and handlers → `chatState.ts`
- Side effects and auto-resume → `chatEffects.ts`
- Orchestration (hook composition) → stays in `useCodexChat.ts`

For `useCodexConversationController.ts`:
- State derivation logic → `conversationState.ts`
- User action handlers (send, approve, interrupt) → `conversationActions.ts`
- Hook composition → stays in `useCodexConversationController.ts`

**Step 2: Extract and update imports**

Move the identified code. Keep hook signatures unchanged.

**Step 3: Verify all files under 20KB**

```bash
wc -c src/react/useCodexChat.ts src/react/chatState.ts src/react/chatEffects.ts src/react/useCodexConversationController.ts src/react/conversationState.ts src/react/conversationActions.ts
```

**Step 4: Run tests**

```bash
pnpm run test
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(react): split oversized hook files into focused modules"
```

---

### Task 12: Split remaining oversized files

**Files:**
- Modify: `src/component/deletionInternal.ts` (25KB)
- Create: `src/component/deletionCascade.ts`
- Conditionally split: `src/host/convexPreset.ts` (check size after dispatch removal)
- Conditionally split: `src/host/convexSlice.ts` (check size after dispatch removal)

**Step 1: Check file sizes after dispatch removal**

```bash
wc -c src/component/deletionInternal.ts src/host/convexPreset.ts src/host/convexSlice.ts
```

Only split files still over 20KB (20,480 bytes).

**Step 2: Split deletionInternal.ts**

Extract per-table cascade deletion logic into `deletionCascade.ts`. Keep orchestrator/scheduler in `deletionInternal.ts`.

**Step 3: Conditionally split convexPreset.ts**

If over 20KB after dispatch removal: extract mutation definitions into `presetMutations.ts` and query definitions into `presetQueries.ts`.

**Step 4: Conditionally split convexSlice.ts**

If over 20KB after dispatch removal: extract query wrappers into `sliceQueries.ts` and mutation wrappers into `sliceMutations.ts`.

**Step 5: Verify sizes and run tests**

```bash
pnpm run test && pnpm run typecheck
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: split remaining oversized files"
```

---

### Task 13: Remove unused React hooks

**Files:**
- Delete: `src/react/useCodexComposer.ts`
- Delete: `src/react/useCodexApprovals.ts`
- Delete: `src/react/useCodexInterruptTurn.ts`
- Delete: `src/react/useCodexAutoResume.ts`
- Modify: `src/react/index.ts` (remove exports for deleted hooks)

**Step 1: Delete the 4 hook files**

Remove each file entirely.

**Step 2: Remove exports from src/react/index.ts**

Remove these export blocks:
- `useCodexComposer` and its types (lines 92-95)
- `useCodexApprovals` and its types (lines 76-82)
- `useCodexInterruptTurn` (lines 84-85)
- `useCodexAutoResume` and its types (lines 87-90)

**Step 3: Search for internal imports of deleted hooks**

```bash
grep -rn "useCodexComposer\|useCodexApprovals\|useCodexInterruptTurn\|useCodexAutoResume" src/ --include="*.ts"
```

If any internal files import these hooks, update them.

**Step 4: Run tests**

```bash
pnpm run test
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(react): remove unused standalone hooks"
```

---

### Task 14: Internalize useCodexConversationController

**Files:**
- Modify: `src/react/index.ts` (remove public export)
- Modify: `src/react-integration/index.ts` (update import path — still imports from internal location)

**Step 1: Remove public export from src/react/index.ts**

Remove the `useCodexConversationController` export block (lines 36-40) and its associated types (`CodexConversationControllerConfig`, `CodexConversationApprovalDecision`, `CodexConversationApprovalItem`).

**Step 2: Verify internal consumers still work**

`useCodexChat.ts` imports `useCodexConversationController` directly from `"./useCodexConversationController.js"` — this is an internal import, unaffected by export removal.

`react-integration/index.ts` imports from `"../react/useCodexConversationController.js"` — this is also an internal import, unaffected.

**Step 3: Check for external consumers**

```bash
grep -rn "useCodexConversationController" apps/ --include="*.ts" --include="*.tsx"
```

If any example apps import `useCodexConversationController` from the public path, update them to use `useCodexChat` instead.

**Step 4: Run tests**

```bash
pnpm run test
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(react): internalize useCodexConversationController"
```

---

### Task 15: Remove unused schema index

**Files:**
- Modify: `src/component/schema.ts`

**Step 1: Remove unused index**

Find the `codex_stream_deltas_ttl` table definition and remove the standalone `userScope` index. Keep `userScope_streamId_eventId` and other specific indexes.

**Step 2: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor(schema): remove unused codex_stream_deltas_ttl userScope index"
```

---

### Task 16: Update documentation

**Files:**
- Modify: `LLMS.md` (remove `/client` references, remove dispatch-managed references)
- Modify: `docs/API_REFERENCE.md` (reflect new export paths, remove deleted hooks)
- Modify: `docs/HOST_INTEGRATION.md` (remove dispatch-managed references)
- Modify: `docs/CLIENT_AND_REACT_HOOKS.md` (update hook list, remove deleted hooks)
- Modify: `docs/OPERATIONS_AND_ERRORS.md` (remove dispatch error codes)

**Step 1: Update LLMS.md**

- Remove all references to `/client` export path
- Remove `dispatchManaged` mode references
- Update the consumer quick-start to only show runtime-owned
- Remove `useCodexComposer`, `useCodexApprovals`, `useCodexInterruptTurn`, `useCodexAutoResume` from hook listings
- Remove `useCodexConversationController` from public hook listings
- Update import paths: `/bridge` → `/host`, `/app-server` → `/host`, `/errors` → default import

**Step 2: Update API_REFERENCE.md**

- Remove sections for deleted export paths (`/client`, `/errors`, `/bridge`, `/app-server`)
- Move relevant content to remaining sections
- Remove deleted hook entries
- Remove dispatch-related entries

**Step 3: Update HOST_INTEGRATION.md**

- Remove all dispatch-managed mode documentation
- Remove `defineDispatchManagedHostEndpoints` references
- Simplify to runtime-owned only

**Step 4: Update CLIENT_AND_REACT_HOOKS.md**

- Remove deleted hooks from listings
- Remove `useCodexConversationController` from public API section
- Remove dispatch-related client functions

**Step 5: Update OPERATIONS_AND_ERRORS.md**

- Remove dispatch-related error codes (E_RUNTIME_DISPATCH_MODE_REQUIRED, E_RUNTIME_DISPATCH_MODE_CONFLICT, etc.)

**Step 6: Run docs CI check**

```bash
pnpm run check:docs:single-path && pnpm run check:api-reference
```

**Step 7: Commit**

```bash
git add -A && git commit -m "docs: update all documentation for beta restructure"
```

---

### Task 17: Update CI scripts

**Files:**
- Modify: `scripts/check-mount-imports.mjs` (verify still correct)
- Modify: `scripts/check-api-reference-useful.mjs` (already updated in Task 8)
- Modify: `scripts/check-docs-single-path.mjs` (already updated in Task 5)

**Step 1: Review each CI script**

Verify all scripts reference only the 7 remaining export paths. Remove references to deleted paths or dispatch patterns.

**Step 2: Run full CI**

```bash
pnpm run ci
```

**Step 3: Run full monorepo CI**

```bash
cd ../.. && pnpm run ci
```

**Step 4: Commit (if changes needed)**

```bash
git add -A && git commit -m "chore: update CI scripts for restructured exports"
```

---

### Task 18: Create changeset and final verification

**Files:**
- Create: `.changeset/beta-architecture-restructure.md`

**Step 1: Create changeset**

```bash
cd ../.. # monorepo root
```

Create `.changeset/beta-architecture-restructure.md`:
```markdown
---
"@zakstam/codex-local-component": minor
---

Beta architecture restructure: remove dispatch-managed mode, eliminate client passthrough layer, consolidate export paths (11 to 7), split oversized files, simplify React hook surface.

Breaking changes:
- Removed `./client` export path (use default import or `./host/convex`)
- Removed `./errors` export path (use default import)
- Removed `./bridge` export path (use `./host`)
- Removed `./app-server` export path (use `./host`)
- Removed dispatch-managed mode (use runtime-owned exclusively)
- Removed `useCodexComposer`, `useCodexApprovals`, `useCodexInterruptTurn`, `useCodexAutoResume` hooks
- `useCodexConversationController` is no longer publicly exported (use `useCodexChat`)
- Removed `codex_turn_dispatches` table from schema
```

**Step 2: Run full CI one final time**

```bash
pnpm run ci && pnpm -w run ci
```

Expected: All checks pass.

**Step 3: Verify success criteria**

- [ ] All CI checks pass (`pnpm component:ci`)
- [ ] All example apps typecheck
- [ ] Smoke host passes
- [ ] No `/client` imports remain: `grep -rn "codex-local-component/client" apps/ packages/`
- [ ] No dispatch-managed references remain: `grep -rn "dispatchManaged\|DispatchManaged\|codex_turn_dispatches" packages/codex-local-component/src/`
- [ ] All source files under 20KB: `find src/ -name "*.ts" -size +20k`
- [ ] Export paths reduced to 7: count entries in `package.json` exports
- [ ] React hook exports reduced: count exports in `src/react/index.ts`

**Step 4: Commit changeset**

```bash
git add -A && git commit -m "chore: add changeset for beta architecture restructure"
```

---

### Task 19: Add ADR for this restructure

**Files:**
- Modify: `ARCHITECTURE_DECISIONS.md`

**Step 1: Add new ADR entry**

Add to the Decision Log:

```markdown
### ADR-20260214-beta-architecture-restructure
- Status: accepted
- Context: Preparing for beta/GA required reducing complexity and locking the API surface. Dispatch-managed mode was non-canonical, the client layer was pure passthrough, export paths were excessive, and several files exceeded 20KB.
- Decision: Remove dispatch-managed mode entirely, eliminate the client passthrough layer, consolidate from 11 to 7 export paths, split files over 20KB, remove unused React hooks, and internalize useCodexConversationController.
- Consequences: Simpler API surface for beta consumers; ~70KB of dispatch code removed; 4 fewer export paths; runtime-owned is the only host mode; some hooks removed (useCodexComposer, useCodexApprovals, useCodexInterruptTurn, useCodexAutoResume).
- Slice Impact: component (schema, dispatch removal), host (simplified wiring), react (reduced hook surface), docs/tests (updated)
```

**Step 2: Commit**

```bash
git add -A && git commit -m "docs: add ADR for beta architecture restructure"
```
