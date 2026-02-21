# TypeScript 7 Default Typecheck Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `tsgo` (TypeScript 7 native preview) the default typecheck command across this monorepo while retaining `tsc` where needed for build artifacts and fallback verification.

**Architecture:** Keep the change as an additive tooling slice: install `@typescript/native-preview`, switch `typecheck` scripts to `tsgo`, add explicit `typecheck:tsc` fallback scripts, and update docs/runbook to reflect the new default behavior. Preserve existing host/component boundaries and avoid behavioral runtime changes.

**Tech Stack:** pnpm workspaces, Node scripts, TypeScript/tsgo, Convex example apps.

---

### Task 1: Update workspace script contracts

**Files:**
- Modify: `package.json`
- Modify: `packages/codex-local-component/package.json`
- Modify: `apps/examples/cli-app/package.json`
- Modify: `apps/examples/persistent-cli-app/package.json`
- Modify: `apps/examples/debug-harness/package.json`
- Modify: `apps/examples/tauri-app/package.json`

1. Add `@typescript/native-preview` dev dependency in each workspace package that runs `typecheck`.
2. Switch `typecheck` scripts from `tsc --noEmit` to `tsgo --noEmit`.
3. Add `typecheck:tsc` scripts preserving prior `tsc --noEmit` behavior.
4. Keep build scripts on `tsc` unchanged.

### Task 2: Update docs for new default

**Files:**
- Modify: `packages/codex-local-component/README.md`
- Modify: `apps/examples/debug-harness/README.md`

1. Add a short TS7 preview note indicating `tsgo` is default for `typecheck`.
2. Document fallback command `pnpm run typecheck:tsc`.
3. Ensure wording stays aligned with fail-closed verification guidance.

### Task 3: Create changeset for published package

**Files:**
- Create: `.changeset/tsgo-default-typecheck.md`

1. Add patch changeset for `@zakstam/codex-local-component` describing default `tsgo` typecheck and fallback script.

### Task 4: Verify fail-closed

**Commands:**
1. `pnpm -C codex-convex-component install`
2. `pnpm -C codex-convex-component run typecheck`
3. `pnpm -C codex-convex-component --filter @zakstam/codex-local-component run typecheck:tsc`
4. `pnpm -C codex-convex-component run example:debug:repro:no-response`

Expected: all commands succeed; if any command fails, treat task as incomplete.
