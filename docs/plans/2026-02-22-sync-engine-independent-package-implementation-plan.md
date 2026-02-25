# Sync Engine Independent Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract durable conversation sync into an independent, persistence-agnostic package with adapter-owned execution and a shared portability/conformance kit.

**Architecture:** Create `@zakstam/codex-sync-engine` as the source of truth for sync contracts, lifecycle state/policy helpers, canonical sync errors, and adapter conformance tests. Keep runtime backend-neutral by consuming sync-engine contracts only. Keep Convex-specific wiring in `@zakstam/codex-runtime-convex` as one adapter implementation.

**Tech Stack:** TypeScript, pnpm workspaces, Node test runner (`node --test`), Convex host definitions, Changesets.

---

### Task 1: Establish package scaffold and ownership boundaries

**Files:**
- Create: `codex-convex-component/packages/codex-sync-engine/package.json`
- Create: `codex-convex-component/packages/codex-sync-engine/tsconfig.json`
- Create: `codex-convex-component/packages/codex-sync-engine/tsconfig.build.json`
- Create: `codex-convex-component/packages/codex-sync-engine/src/index.ts`
- Create: `codex-convex-component/packages/codex-sync-engine/README.md`
- Modify: `codex-convex-component/pnpm-workspace.yaml`
- Modify: `codex-convex-component/package.json`

**Step 1: Write a failing package presence check**

Add/update workspace check script so missing `packages/codex-sync-engine` causes failure.

**Step 2: Run check to verify it fails**

Run: `pnpm -C codex-convex-component run lint`
Expected: FAIL because workspace/scripts do not yet include `codex-sync-engine`.

**Step 3: Add minimal package scaffold**

Create package manifest + tsconfigs + placeholder exports in `src/index.ts`.

**Step 4: Run check to verify it passes**

Run: `pnpm -C codex-convex-component install && pnpm -C codex-convex-component run lint`
Expected: PASS for workspace/package resolution.

**Step 5: Commit**

```bash
git -C codex-convex-component add pnpm-workspace.yaml package.json packages/codex-sync-engine
git -C codex-convex-component commit -m "feat: scaffold codex-sync-engine package"
```

### Task 2: Define canonical sync contracts and domain errors

**Files:**
- Create: `codex-convex-component/packages/codex-sync-engine/src/contracts.ts`
- Create: `codex-convex-component/packages/codex-sync-engine/src/errors.ts`
- Modify: `codex-convex-component/packages/codex-sync-engine/src/index.ts`
- Test: `codex-convex-component/packages/codex-sync-engine/test/contracts.test.mjs`

**Step 1: Write failing contract tests**

Add tests that import contract types/errors and assert expected surface exists:
- adapter methods for source lifecycle (`start`, `append`, `seal`)
- job methods (`get`, `cancel`, `waitForTerminal`)
- canonical error code mapping helpers

**Step 2: Run tests to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test`
Expected: FAIL with missing exports/types.

**Step 3: Implement minimal contracts + errors**

Define:
- `SyncEngineAdapter`
- `SyncEngineJobSnapshot`
- `SyncEngineTerminalSnapshot`
- canonical sync error type + code union and guard/normalizer

**Step 4: Run tests to verify pass**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-sync-engine/src packages/codex-sync-engine/test/contracts.test.mjs
git -C codex-convex-component commit -m "feat: add sync engine contracts and canonical errors"
```

### Task 3: Implement pure sync policy/state helpers

**Files:**
- Create: `codex-convex-component/packages/codex-sync-engine/src/policy.ts`
- Create: `codex-convex-component/packages/codex-sync-engine/src/state.ts`
- Modify: `codex-convex-component/packages/codex-sync-engine/src/index.ts`
- Test: `codex-convex-component/packages/codex-sync-engine/test/policy-state.test.mjs`

**Step 1: Write failing state/policy tests**

Cover:
- immutable chunk index acceptance/rejection
- seal preconditions (contiguous chunks, expected checksum)
- retry/backoff progression
- terminal state transitions

**Step 2: Run tests to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test -- test/policy-state.test.mjs`
Expected: FAIL.

**Step 3: Implement minimal pure helpers**

Add deterministic pure helpers (no IO):
- checksum utility
- seal validator
- retry policy calculator
- state transition reducer

**Step 4: Run tests to verify pass**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test -- test/policy-state.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-sync-engine/src packages/codex-sync-engine/test/policy-state.test.mjs
git -C codex-convex-component commit -m "feat: add sync engine policy and state helpers"
```

### Task 4: Add reference in-memory adapter

**Files:**
- Create: `codex-convex-component/packages/codex-sync-engine/src/memoryAdapter.ts`
- Modify: `codex-convex-component/packages/codex-sync-engine/src/index.ts`
- Test: `codex-convex-component/packages/codex-sync-engine/test/memory-adapter.test.mjs`

**Step 1: Write failing memory adapter tests**

Cover source start/append/seal, job polling to terminal, cancellation, and checksum mismatch failure behavior.

**Step 2: Run tests to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test -- test/memory-adapter.test.mjs`
Expected: FAIL.

**Step 3: Implement minimal in-memory adapter**

Implement `createInMemorySyncEngineAdapter()` using `Map` storage and pure state/policy helpers.

**Step 4: Run tests to verify pass**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test -- test/memory-adapter.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-sync-engine/src packages/codex-sync-engine/test/memory-adapter.test.mjs
git -C codex-convex-component commit -m "feat: add in-memory sync engine adapter"
```

### Task 5: Build adapter conformance test kit

**Files:**
- Create: `codex-convex-component/packages/codex-sync-engine/src/conformance.ts`
- Test: `codex-convex-component/packages/codex-sync-engine/test/conformance-kit.test.mjs`
- Modify: `codex-convex-component/packages/codex-sync-engine/src/index.ts`

**Step 1: Write failing conformance harness tests**

Test that `runSyncAdapterConformanceSuite(factory)` executes scenarios and returns structured pass/fail diagnostics.

**Step 2: Run tests to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test -- test/conformance-kit.test.mjs`
Expected: FAIL.

**Step 3: Implement conformance suite API**

Implement scenario runner + shared fixtures for:
- chunk immutability
- seal invariants
- retry/terminal semantics
- cancellation semantics

**Step 4: Run tests to verify pass**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test -- test/conformance-kit.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-sync-engine/src packages/codex-sync-engine/test/conformance-kit.test.mjs
git -C codex-convex-component commit -m "feat: add sync adapter conformance test suite"
```

### Task 6: Rewire runtime to sync-engine contract boundaries only

**Files:**
- Modify: `codex-convex-component/packages/codex-runtime/src/host/runtime/runtimeTypes.ts`
- Modify: `codex-convex-component/packages/codex-runtime/src/host/runtime/runtime.ts`
- Modify: `codex-convex-component/packages/codex-runtime/package.json`
- Test: `codex-convex-component/packages/codex-runtime/test/sync-job-binding-failure.test.mjs`
- Test: `codex-convex-component/packages/codex-runtime/test/sync-hydration-status.test.mjs`

**Step 1: Write/adjust failing runtime tests for contract-only assumptions**

Update tests to assert runtime behavior uses sync contract semantics (no Convex-specific fields/assumptions).

**Step 2: Run tests to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run test -- test/sync-job-binding-failure.test.mjs test/sync-hydration-status.test.mjs`
Expected: FAIL before rewiring.

**Step 3: Refactor runtime types and call sites**

Depend on sync-engine exported contracts/types and preserve existing runtime behavior.

**Step 4: Run tests to verify pass**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run test -- test/sync-job-binding-failure.test.mjs test/sync-hydration-status.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime/src/host/runtime/runtimeTypes.ts packages/codex-runtime/src/host/runtime/runtime.ts packages/codex-runtime/package.json packages/codex-runtime/test/sync-job-binding-failure.test.mjs packages/codex-runtime/test/sync-hydration-status.test.mjs
git -C codex-convex-component commit -m "refactor: consume sync engine contracts from runtime"
```

### Task 7: Make Convex adapter conform to sync-engine contract

**Files:**
- Modify: `codex-convex-component/packages/codex-runtime-convex/src/convexPersistenceAdapter.ts`
- Modify: `codex-convex-component/packages/codex-runtime-convex/package.json`
- Test: `codex-convex-component/packages/codex-runtime-convex/test/convex-persistence-adapter.test.mjs`
- Create: `codex-convex-component/packages/codex-runtime-convex/test/convex-sync-conformance.test.mjs`

**Step 1: Write failing Convex conformance test**

Wire conformance kit into Convex adapter tests via adapter factory/mocks.

**Step 2: Run tests to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test -- test/convex-sync-conformance.test.mjs`
Expected: FAIL.

**Step 3: Refactor adapter implementation**

Map Convex function refs and response shapes to sync-engine contracts/errors.

**Step 4: Run tests to verify pass**

Run:
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test -- test/convex-sync-conformance.test.mjs`
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test -- test/convex-persistence-adapter.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime-convex/src/convexPersistenceAdapter.ts packages/codex-runtime-convex/package.json packages/codex-runtime-convex/test/convex-sync-conformance.test.mjs packages/codex-runtime-convex/test/convex-persistence-adapter.test.mjs
git -C codex-convex-component commit -m "refactor: align convex persistence adapter with sync engine contract"
```

### Task 8: Dependent surfaces, docs, and cleanup

**Files:**
- Modify: `codex-convex-component/ARCHITECTURE_DECISIONS.md`
- Modify: `codex-convex-component/LLM_WORKFLOW.md`
- Modify: `codex-convex-component/packages/codex-runtime/README.md`
- Modify: `codex-convex-component/packages/codex-runtime/docs/API_REFERENCE.md`
- Modify: `codex-convex-component/packages/codex-runtime/docs/CANONICAL_INTEGRATION.md`
- Modify: `codex-convex-component/packages/codex-runtime-convex/README.md`
- Modify: `codex-convex-component/apps/examples/tauri-app/convex/chat.ts` (if import surface changes)
- Modify: `codex-convex-component/apps/examples/persistent-cli/convex/chat.ts` (if import surface changes)
- Modify: host shim scripts when host sync surface changes
- Create: `codex-convex-component/.changeset/<name>.md`

**Step 1: Write failing docs/boundary checks first where applicable**

If symbol/import checks exist, update tests/scripts to fail on stale sync ownership paths.

**Step 2: Run checks to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run ci`
Expected: FAIL before docs/import updates.

**Step 3: Update dependent paths and docs**

Document new package ownership and conformance expectations. Update examples and shim scripts if sync host surface or imports changed.

**Step 4: Remove obsolete sync code paths**

Delete dead helpers/types left obsolete by extraction (no legacy aliases).

**Step 5: Run full verification gates**

Run:
- `pnpm -C codex-convex-component --filter @zakstam/codex-sync-engine run test`
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test`
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run ci`
- `pnpm -C codex-convex-component --filter codex-runtime-tauri-example run check:host-shim`
- `pnpm -C codex-convex-component --filter codex-runtime-persistent-cli-example run check:host-shim`
Expected: PASS.

**Step 6: Commit**

```bash
git -C codex-convex-component add ARCHITECTURE_DECISIONS.md LLM_WORKFLOW.md packages/codex-runtime/README.md packages/codex-runtime/docs/API_REFERENCE.md packages/codex-runtime/docs/CANONICAL_INTEGRATION.md packages/codex-runtime-convex/README.md apps/examples .changeset
git -C codex-convex-component commit -m "feat: extract durable sync into independent sync engine package"
```
