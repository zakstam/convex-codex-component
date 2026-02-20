# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Convex component for Codex integrations where Codex runs locally while thread state, messages, approvals, and replay are persisted in Convex.

> [!IMPORTANT]
> `@zakstam/codex-local-component` is in **alpha** and ready for active testing.
> It is still experimental and **not** ready for production use.

Canonical default: runtime-owned host integration.

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

React hooks require `react` peer dependency (`^18` or `^19`).

## Canonical Implementation

Use one source of truth for implementation steps:

- `./LLMS.md` (LLM-only execution manifest)
- This README (human onboarding and package integration checklist)

`LLMS.md` is intentionally LLM-targeted; humans should start with this file.

## Quickstart Summary

1. Mount component in `convex/convex.config.ts` with `app.use(codexLocal)`.
2. Generate/sync `convex/chat.ts` host shim (`pnpm run sync:host-shim`).
3. Define host endpoints with `defineCodexHostDefinitions(...)` and explicit `mutation/query` exports.
4. Start runtime in runtime-owned mode.
5. Call `chat.validateHostWiring` at startup.
6. Use `@zakstam/codex-local-component/react` hooks against canonical host endpoints.

## Package Import Paths

- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/host`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/convex.config`
- `@zakstam/codex-local-component/_generated/component.js`
- `@zakstam/codex-local-component/test`

## Docs Map

- Human onboarding entrypoint: `./README.md` (this file)
- Agent execution manifest: `./LLMS.md`
- Canonical implementation guide: `docs/CANONICAL_INTEGRATION.md`
- API reference: `docs/API_REFERENCE.md`
- Example app runbook (setup/checks/env): `docs/EXAMPLE_APPS_RUNBOOK.md`
- Fallback governance policy: `docs/FALLBACK_POLICY.md`

## One-shot LLM handoff prompt for external users

Give this prompt to an LLM after installing the package to get setup and code changes started:

```text
Integrate `@zakstam/codex-local-component` in this project using only this package's docs.

Use this file (`README.md`) first, then follow only the mapped docs for the task:

- Canonical integration: `docs/CANONICAL_INTEGRATION.md`
- API lookup: `docs/API_REFERENCE.md`
- Optional runbook/checks: `docs/EXAMPLE_APPS_RUNBOOK.md`

Keep changes minimal and stay in runtime-owned mode.
Validate with:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run check:host-shim`
- `pnpm run typecheck`

If a prerequisite is missing for an app, ask for package-specific assumptions before continuing.
```

## Human integration checklist

1. Install package dependencies:

```bash
pnpm add @zakstam/codex-local-component convex
```

2. Mount the component in `convex/convex.config.ts`.

3. Generate Convex types before wiring:

```bash
npx convex dev --once
```

4. Generate/sync `convex/chat.ts` from host manifest (`pnpm run sync:host-shim`).

5. Start runtime-owned host wiring through `@zakstam/codex-local-component/host`.

6. Call `chat.validateHostWiring` during startup.

7. Run app checks:

```bash
pnpm run dev:convex:once
pnpm run check:host-shim
pnpm run lint
pnpm run typecheck
```

## Data Lifecycle APIs

The component supports async cascade deletion with job polling:

- `threads.deleteCascade`
- `threads.scheduleDeleteCascade`
- `turns.deleteCascade`
- `turns.scheduleDeleteCascade`
- `threads.purgeActorData`
- `threads.schedulePurgeActorData`
- `threads.cancelScheduledDeletion`
- `threads.forceRunScheduledDeletion`
- `threads.getDeletionJobStatus`

Runtime-owned host endpoints expose the same lifecycle operations as:

- `deleteThread`
- `scheduleDeleteThread`
- `deleteTurn`
- `scheduleDeleteTurn`
- `purgeActorData`
- `schedulePurgeActorData`
- `cancelDeletion`
- `forceRunDeletion`
- `getDeletionStatus`

## Runtime Thread Control APIs

`createCodexHostRuntime(...)` exposes thread control helpers:

- `resumeThread`
- `forkThread`
- `archiveThread`
- `setThreadName`
- `unarchiveThread`
- `compactThread`
- `rollbackThread`
- `readThread`
- `listThreads`
- `listLoadedThreads`

## Type Safety Checks

- `pnpm --filter @zakstam/codex-local-component run codegen:component`
- `pnpm --filter @zakstam/codex-local-component run lint`
- `pnpm --filter @zakstam/codex-local-component run typecheck`
- `pnpm --filter @zakstam/codex-local-component run schema:check`
- `pnpm --filter @zakstam/codex-local-component run check:unsafe-types`
- `pnpm --filter @zakstam/codex-local-component run check:fallback-policy`
- `pnpm --filter @zakstam/codex-local-component run check:component-function-validators`

## Protocol Schema Workflow (Maintainers)

The protocol artifacts under `src/protocol/schemas/**` are generated and committed.
Schema updates are manual and fail closed.

Expected source directory must contain:

- `codex_app_server_protocol.schemas.json`
- `index.ts`
- `v2/index.ts`

Sync from an upstream generated schema directory:

```bash
pnpm --filter @zakstam/codex-local-component run schema:sync -- --source /path/to/codex/generated/schemas
```

Optional source metadata for auditability:

```bash
pnpm --filter @zakstam/codex-local-component run schema:sync -- --source /path/to/codex/generated/schemas --source-ref codex@<commit-or-tag>
```

Drift and contract checks:

```bash
pnpm --filter @zakstam/codex-local-component run schema:check
pnpm --filter @zakstam/codex-local-component run schema:verify
```

`schema:verify` intentionally blocks merge until code/tests/docs are updated for any schema contract break.

## Component Authoring Exports

- `@zakstam/codex-local-component/_generated/component.js`: generated `ComponentApi` type entrypoint for app-side typing.
- `@zakstam/codex-local-component/test`: test helper export (`register`) plus `schema` for component test registration.
