# Codex Runtime Package Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the project to `codex-runtime`, isolate core as runtime-only, and move all non-core capabilities into dedicated packages without requiring future core edits.

**Architecture:** Keep `@zakstam/codex-runtime` as the only runtime-core package. Consolidate Convex host + persistence into one integration package, move hooks into a dedicated React package, and extract Tauri bridge + protocol tooling into separate packages. Enforce dependency direction with fail-closed checks.

**Tech Stack:** TypeScript, pnpm workspaces, Convex, Node test runner, Changesets, existing repo boundary checks.

---

### Task 1: Baseline + naming inventory

**Files:**
- Modify: `codex-convex-component/docs/plans/agent-locks.md`
- Create: `codex-convex-component/docs/plans/2026-02-22-rename-inventory.md`

**Step 1: Capture all old naming usages**

Run: `rg -n "codex-local-component|codex-convex-component|codex-local-" codex-convex-component`
Expected: list of all rename touchpoints.

**Step 2: Capture import/export surface before changes**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run build`
Expected: PASS.

**Step 3: Commit inventory artifacts**

Run:
```bash
git -C codex-convex-component add docs/plans/2026-02-22-rename-inventory.md docs/plans/agent-locks.md
git -C codex-convex-component commit -m "chore: capture codex-runtime rename inventory"
```

### Task 2: Rename workspace/packages to `codex-runtime`

**Files:**
- Modify: `codex-convex-component/package.json`
- Modify: `codex-convex-component/pnpm-workspace.yaml`
- Modify: `codex-convex-component/packages/codex-runtime/package.json`
- Modify: `codex-convex-component/packages/codex-runtime-convex/package.json`
- Modify: `codex-convex-component/apps/examples/*/package.json`

**Step 1: Write failing rename consistency test**

Add/extend a script check in `codex-convex-component/packages/codex-runtime/scripts/check-canonical-symbols.mjs` asserting old package names are absent from package manifests.

**Step 2: Run test to verify it fails first**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run check:canonical-symbols`
Expected: FAIL with old package names detected.

**Step 3: Apply minimal rename in manifests/workspace**

Update names/dependencies/scripts from `codex-local-*` to `codex-runtime-*`.

**Step 4: Re-run check**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run check:canonical-symbols`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add package.json pnpm-workspace.yaml packages/*/package.json apps/examples/*/package.json packages/codex-runtime/scripts/check-canonical-symbols.mjs
git -C codex-convex-component commit -m "refactor: rename workspace and packages to codex-runtime"
```

### Task 3: Enforce runtime-only core boundary

**Files:**
- Modify: `codex-convex-component/packages/codex-runtime/src/index.ts`
- Modify: `codex-convex-component/packages/codex-runtime/src/host/index.ts`
- Modify: `codex-convex-component/packages/codex-runtime/scripts/check-host-boundaries.mjs`
- Test: `codex-convex-component/packages/codex-runtime/test/host-convex-slice.test.mjs`

**Step 1: Write failing boundary test/check**

Add assertions that core public exports do not expose Convex host bindings, Tauri bridge, or protocol tooling implementation paths.

**Step 2: Run to verify failure**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run test -- test/host-convex-slice.test.mjs`
Expected: FAIL because old exports still exist.

**Step 3: Remove non-core exports from core**

Keep only runtime-core contracts and runtime construction in core export surface.

**Step 4: Validate boundary checks**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run check:host-boundaries`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime/src/index.ts packages/codex-runtime/src/host/index.ts packages/codex-runtime/scripts/check-host-boundaries.mjs packages/codex-runtime/test/host-convex-slice.test.mjs
git -C codex-convex-component commit -m "refactor: enforce runtime-only core exports"
```

### Task 4: Unify Convex host + persistence into one package

**Files:**
- Modify/Create: `codex-convex-component/packages/codex-runtime-convex/src/index.ts`
- Create: `codex-convex-component/packages/codex-runtime-convex/src/host/index.ts`
- Create: `codex-convex-component/packages/codex-runtime-convex/src/persistence/index.ts`
- Move/Modify: existing files from `packages/codex-runtime-convex/src/*`
- Modify: example `convex/chat.ts` files

**Step 1: Write failing import test for new Convex subpaths**

Add test: importing `@zakstam/codex-runtime-convex/host` and `@zakstam/codex-runtime-convex/persistence` resolves.

**Step 2: Run test (expect fail)**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test`
Expected: FAIL due to missing subpath exports.

**Step 3: Implement package structure and exports**

Expose host definitions + persistence adapter in one package with explicit subpath exports.

**Step 4: Re-run Convex package tests and app typechecks**

Run:
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test`
- `pnpm -C codex-convex-component --filter codex-runtime-tauri-example run check:host-shim`
- `pnpm -C codex-convex-component --filter codex-runtime-persistent-cli-example run check:host-shim`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime-convex apps/examples/*/convex/chat.ts apps/examples/*/scripts/*host-shim*.mjs
git -C codex-convex-component commit -m "feat: unify convex host and persistence package"
```

### Task 5: Extract React hooks package

**Files:**
- Create: `codex-convex-component/packages/codex-runtime-react/package.json`
- Create: `codex-convex-component/packages/codex-runtime-react/src/index.ts`
- Move/Modify: `codex-convex-component/packages/codex-runtime/src/react/**`
- Modify: React-consuming example imports

**Step 1: Write failing hook import test from new package**

Add test that hooks import from `@zakstam/codex-runtime-react` only.

**Step 2: Run test (expect fail)**

Run: `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-react run typecheck`
Expected: FAIL until package and imports exist.

**Step 3: Move hooks and update imports**

Keep hooks adapter-agnostic and remove hook exports from core.

**Step 4: Validate**

Run:
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-react run typecheck`
- `pnpm -C codex-convex-component --filter codex-runtime-tauri-example run typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime-react packages/codex-runtime/src/react apps/examples/tauri-app/src
git -C codex-convex-component commit -m "feat: extract react hooks into codex-runtime-react"
```

### Task 6: Extract Tauri bridge package

**Files:**
- Create: `codex-convex-component/packages/codex-runtime-bridge-tauri/package.json`
- Create: `codex-convex-component/packages/codex-runtime-bridge-tauri/src/index.ts`
- Move/Modify: `codex-convex-component/packages/codex-runtime/src/host/tauri.ts`
- Move/Modify: `codex-convex-component/packages/codex-runtime/src/local-adapter/**`
- Modify: tauri app + debug-harness imports

**Step 1: Add failing compile check for removed core bridge exports**

Run typecheck expecting failures where imports still target core.

**Step 2: Update package and imports**

Move bridge APIs to `@zakstam/codex-runtime-bridge-tauri`.

**Step 3: Validate tauri/debug harness**

Run:
- `pnpm -C codex-convex-component --filter codex-runtime-tauri-example run typecheck`
- `pnpm -C codex-convex-component --filter codex-runtime-debug-harness run typecheck`
Expected: PASS.

**Step 4: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime-bridge-tauri apps/examples/tauri-app apps/examples/debug-harness packages/codex-runtime/src/host/tauri.ts packages/codex-runtime/src/local-adapter
git -C codex-convex-component commit -m "feat: extract tauri bridge package"
```

### Task 7: Extract protocol tooling package

**Files:**
- Create: `codex-convex-component/packages/codex-runtime-protocol-tooling/package.json`
- Create: `codex-convex-component/packages/codex-runtime-protocol-tooling/src/index.ts`
- Move/Modify: `codex-convex-component/packages/codex-runtime/src/protocol/**` (tooling-only files)
- Modify: schema check/sync scripts and tests

**Step 1: Identify runtime-essential vs tooling-only protocol files**

Use a small allowlist in plan implementation to avoid moving runtime-critical contracts.

**Step 2: Write failing tests for new tooling import paths**

Run existing protocol tests with imports switched to new package; expect fail before move.

**Step 3: Move tooling files and update scripts**

Rewire `schema:sync` and `schema:check` to run from tooling package.

**Step 4: Validate**

Run:
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-protocol-tooling run test`
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run test`
Expected: PASS.

**Step 5: Commit**

```bash
git -C codex-convex-component add packages/codex-runtime-protocol-tooling packages/codex-runtime/src/protocol packages/codex-runtime/scripts
 git -C codex-convex-component commit -m "feat: extract protocol tooling package"
```

### Task 8: Dependent updates (examples, docs, checks, cleanup)

**Files:**
- Modify: `codex-convex-component/LLM_WORKFLOW.md`
- Modify: `codex-convex-component/ARCHITECTURE_DECISIONS.md`
- Modify: `codex-convex-component/packages/*/README.md`
- Modify: `codex-convex-component/packages/codex-runtime/docs/**`
- Modify: all example app READMEs and imports
- Create: `.changeset/*.md` (for published package changes)

**Step 1: Update architecture docs with new package map**

Document runtime-only core and package ownership matrix.

**Step 2: Update integration docs + runbooks**

Replace old import paths with canonical new paths.

**Step 3: Remove obsolete files/aliases**

Delete deprecated exports and stale scripts.

**Step 4: Add changeset**

Create a changeset for `@zakstam/codex-runtime` user-facing changes (expected `minor` due to new package architecture + rename).

**Step 5: Final verification gate**

Run:
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime run ci`
- `pnpm -C codex-convex-component --filter @zakstam/codex-runtime-convex run test`
- `pnpm -C codex-convex-component --filter codex-runtime-tauri-example run typecheck`
- `pnpm -C codex-convex-component --filter codex-runtime-persistent-cli-example run typecheck`
- `pnpm -C codex-convex-component --filter codex-runtime-debug-harness run typecheck`
Expected: all PASS.

**Step 6: Commit**

```bash
git -C codex-convex-component add .
git -C codex-convex-component commit -m "docs: sync architecture and integration docs for codex-runtime packages"
```
