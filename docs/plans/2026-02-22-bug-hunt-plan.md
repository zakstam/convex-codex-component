# Bug Hunt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Find and prioritize the highest-value bugs in `@zakstam/codex-local-component` with fail-closed verification and architecture-aligned fixes.

**Architecture:** This plan follows a vertical-slice bug hunt: host contracts, runtime lifecycle, durable sync, component integrity, protocol, and React integration. We run hard gates first, then targeted suites, then focused static checks, and end with architecture recommendations (no workaround fixes).

**Tech Stack:** pnpm workspace, Convex, TypeScript (`tsgo`), Node test runner, host shim tooling.

---

### Task 1: Establish clean bug-hunt baseline

**Files:**
- Modify: `codex-convex-component/docs/plans/agent-locks.md`
- Create: `codex-convex-component/.output.txt` (command output log)

**Step 1: Reserve file ownership locks**

Update `docs/plans/agent-locks.md` with active ownership for bug-hunt touched areas.

**Step 2: Capture git baseline**

Run: `pnpm -C codex-convex-component exec git status --short`
Expected: Current workspace state captured for later diff checks.

**Step 3: Capture package + tool versions**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component exec node -v && pnpm -C codex-convex-component -v`
Expected: Version values printed and logged.

**Step 4: Commit checkpoint (optional for execution session)**

```bash
git add docs/plans/agent-locks.md
git commit -m "chore: reserve bug-hunt file ownership"
```

### Task 2: Run full package CI gate first (highest signal)

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/*.test.mjs`

**Step 1: Run full CI gate**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run ci`
Expected: PASS with all checks green, or immediate failing command and error output.

**Step 2: Record first failing gate and stack trace**

Append failing command, error code, and first stack location to `.output.txt`.

**Step 3: Classify failure slice**

Label each failure as `host wiring`, `component runtime`, `protocol/classifier`, `types/contracts`, or `docs/check`.

**Step 4: Commit checkpoint (optional for execution session)**

```bash
git add .output.txt
git commit -m "chore: capture initial ci gate failures"
```

### Task 3: Validate host boundary and shim drift (contract-critical)

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/scripts/check-host-boundaries.mjs`
- Test: `codex-convex-component/apps/examples/tauri-app/scripts/sync-host-shim.mjs`
- Test: `codex-convex-component/apps/examples/tauri-app/convex/chat.ts`

**Step 1: Run host-boundary guard**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run check:host-boundaries`
Expected: PASS; no forbidden cross-context imports.

**Step 2: Check Tauri example shim drift**

Run: `pnpm -C codex-convex-component --filter codex-local-tauri-example run check:host-shim`
Expected: PASS; generated shim matches canonical manifest.

**Step 3: Check persistent CLI example shim drift**

Run: `pnpm -C codex-convex-component --filter codex-local-persistent-cli-example run check:host-shim`
Expected: PASS.

**Step 4: If fail, produce failing diff**

Run: `pnpm -C codex-convex-component --filter codex-local-tauri-example run sync:host-shim && pnpm -C codex-convex-component exec git diff -- apps/examples/tauri-app/convex/chat.ts`
Expected: Deterministic diff showing contract drift root.

### Task 4: Probe conversation identity contract regressions

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/conversation-contract.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/conversation-identity-persistence.test.mjs`
- Modify (if bug fixed): `codex-convex-component/packages/codex-local-component/src/host/contracts.ts`

**Step 1: Run conversation contract tests only**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/conversation-contract.test.mjs test/conversation-identity-persistence.test.mjs`
Expected: PASS or precise assertion failures.

**Step 2: Inspect failures for internal identity leaks**

Flag any public API exposure of thread-mapping internals (`threadHandle`, persistence ids).

**Step 3: Write architecture recommendation (no workaround)**

Use canonical format in `ARCHITECTURE_DECISIONS.md`:
- Recommendation
- Why now
- Simplicity impact
- Maintenance impact
- Scalability impact
- Evidence
- Required dependent updates
- Required docs updates
- Cleanup required

### Task 5: Stress runtime lifecycle and send gating

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/host-runtime.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/host-tauri.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/sync-job-binding-failure.test.mjs`

**Step 1: Run runtime lifecycle suites**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/host-runtime.test.mjs test/host-tauri.test.mjs test/sync-job-binding-failure.test.mjs`
Expected: PASS; otherwise lifecycle phase/source error details captured.

**Step 2: Verify fail-closed behavior**

Check for regressions around `connect -> openThread -> send` sequencing and `process_exit` handling.

**Step 3: Capture reproduction command for runtime stalls (if needed)**

Run: `pnpm -C codex-convex-component run example:debug:repro:no-response`
Expected: Repro trace path for investigation when runtime issue appears.

### Task 6: Validate durable sync job correctness and hydration

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/ingest-pipeline.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/ingest-stream-linking.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/sync-hydration-status.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/mark-sync-progress.test.mjs`

**Step 1: Run sync-focused tests**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/ingest-pipeline.test.mjs test/ingest-stream-linking.test.mjs test/sync-hydration-status.test.mjs test/mark-sync-progress.test.mjs`
Expected: PASS; no chunk ordering or manifest verification mismatches.

**Step 2: Validate expected-message manifest semantics**

Inspect failures involving `expectedMessageCount` and `expectedMessageIdsJson` terminal conditions.

**Step 3: Ensure send blocking policy during syncing state**

Confirm behavior when `syncProgress.syncState === "syncing"` matches docs and tests.

### Task 7: Verify safe-by-default thread reads and request polling contract

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/host-convex-slice.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/host-convex-preset.test.mjs`

**Step 1: Run safe-read tests**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/host-convex-slice.test.mjs test/host-convex-preset.test.mjs`
Expected: PASS; missing-thread pending-request query returns `[]`.

**Step 2: Capture mismatch examples**

Document any throw-vs-status inconsistency and impacted API function names.

### Task 8: Validate protocol parser/classifier + schema drift

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/protocol-events.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/classifier.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/scripts/check-protocol-schemas.mjs`

**Step 1: Run protocol schema check**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run schema:check`
Expected: PASS.

**Step 2: Run parser/classifier tests**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/protocol-events.test.mjs test/classifier.test.mjs`
Expected: PASS.

**Step 3: Document wire-level breaking signatures**

Capture event name/payload causing any regression.

### Task 9: Verify auth scope isolation + deletion integrity

**Files:**
- Test: `codex-convex-component/packages/codex-local-component/test/host-actor-auth.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/conversation-identity-persistence.test.mjs`
- Test: `codex-convex-component/packages/codex-local-component/test/host-runtime-core-handler-utils.test.mjs`

**Step 1: Run actor/auth tests**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/host-actor-auth.test.mjs test/conversation-identity-persistence.test.mjs test/host-runtime-core-handler-utils.test.mjs`
Expected: PASS; no anonymous/user scope cross-read.

**Step 2: Confirm lifecycle deletion semantics**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run test -- test/optimistic-updates.test.mjs`
Expected: PASS; deletion status and optimistic presets are coherent.

### Task 10: Triage findings and produce fix queue

**Files:**
- Create: `codex-convex-component/docs/plans/2026-02-22-bug-hunt-findings.md`
- Modify: `codex-convex-component/ARCHITECTURE_DECISIONS.md` (if architectural decision update is needed)
- Modify: `codex-convex-component/packages/codex-local-component/docs/API_REFERENCE.md` (if contract behavior changes)

**Step 1: Create ranked findings list**

Rank by `severity x blast radius x reproducibility` with file/line references.

**Step 2: For each P0/P1, write architecture-first recommendation**

Use the canonical recommendation format from `ARCHITECTURE_DECISIONS.md`.

**Step 3: Define dependent updates**

List required updates across package code, example apps, host shim scripts, and docs.

**Step 4: Define verification checklist per fix item**

For each queued fix, include exact test/check commands that must pass before completion.

