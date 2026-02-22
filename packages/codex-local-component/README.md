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

## Typecheck Default (TS7 Preview)

- `pnpm run typecheck` now uses TypeScript 7 preview (`tsgo`) by default.
- `pnpm run build` now uses TypeScript 7 preview (`tsgo`) for emit.
- Use `pnpm run typecheck:tsc` to run the legacy TypeScript compiler (`tsc --noEmit`) when needed.

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
5. Call `chat.validateHostWiring` at startup (`{ actor, conversationId? }`).
6. Use `@zakstam/codex-local-component/react` hooks against canonical host endpoints.
7. Prefer safe-by-default thread read queries. Most thread reads return status payloads in place of strict throw-only variants, while `listPendingServerRequests` returns an empty list (`[]`) when the thread is missing instead of throwing.
8. Run `pnpm --filter @zakstam/codex-local-component run doctor:integration` to fail fast on setup drift.

## Package Import Paths

- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/host`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/host/contracts`
- `@zakstam/codex-local-component/host/tooling`
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

6. Call `chat.validateHostWiring` during startup (`{ actor, conversationId? }`).
7. Prefer `resolveActorFromAuth(ctx, requestedActor?)` for host actor binding from Convex auth identity.

7. Run app checks:

```bash
pnpm run dev:convex:once
pnpm run check:host-shim
pnpm run lint
pnpm run typecheck
```

8. Run package doctor checks for canonical contract drift:

```bash
pnpm --filter @zakstam/codex-local-component run doctor:integration
```

## Integration Failure/Fix Matrix

Use these failure classes to unblock quickly:

- `E_DOCTOR_MISSING_FILE`: required canonical docs are missing. Fix by restoring expected docs.
- `E_DOCTOR_CANONICAL_MARKER`: canonical marker drift in package docs. Fix by restoring canonical marker text.
- `E_DOCTOR_LEGACY_ALIAS`: legacy alias symbols leaked into public docs. Fix by replacing with canonical `conversationId` naming.
- `E_DOCTOR_README_ROUTING`: example README not routing to package `LLMS.md`. Fix by restoring canonical routing section.

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

React consumers can apply optimistic updates for these lifecycle operations with codex helpers:

- `useCodexOptimisticMutation(...)`
- `codexOptimisticPresets.deletionStatus.cancel(...)`
- `codexOptimisticPresets.deletionStatus.forceRun(...)`

## Runtime Conversation Control APIs

`createCodexHostRuntime(...)` exposes conversation control helpers:

- Runtime mode is explicit:
  - `mode: "codex-only"`: Codex-authoritative runtime without Convex persistence wiring.
  - `mode: "codex+replica"`: Codex-authoritative runtime with optional Convex replication.

- `openThread` (`start|resume|fork`, conversation-scoped intent)
- `importLocalThreadToPersistence`
- `resumeThread`
- `forkThread`
- `setThreadName`
- `compactThread`
- `rollbackThread`
- `readThread`
- `listThreads`
- `listLoadedThreads`

`listThreads` returns a canonical typed shape: `{ data: Array<{ threadId, preview, updatedAt, messageCount }>, nextCursor }`. `messageCount` is required and runtime-derived via bounded `thread/read(includeTurns=true)` fanout.

- `newConversation`
- `resumeConversation`
- `listConversations`
- `forkConversation`
- `archiveConversation`
- `unarchiveConversation`
- `interruptConversation`
- `getConversationSummary`

`openThread` fail-closes invalid resume/fork identity input: `conversationId` is trimmed and must be non-empty.
When resuming/forking a runtime thread while retaining a different persisted conversation identity, pass `persistedConversationId` to pin persistence binding. Without it, persistence binding follows runtime conversation switches.

`importLocalThreadToPersistence` is the canonical single-call API for importing a local runtime thread into Convex persistence and returning the persisted `conversationId` for UI reads.
`importLocalThreadToPersistence` is unavailable in `mode: "codex-only"` and fail-closes with `E_PERSISTENCE_DISABLED`.
Import now runs as a durable server-owned resumable flow (`collecting -> sealed`, then `queued -> running|retry_wait -> verifying -> succeeded|failed|cancelled`) with public terminal state (`synced|failed|cancelled`), so helper/runtime restarts do not drop in-progress sync.
Sync completion is fail-closed: jobs verify canonical expected message IDs before terminal `synced`; mismatches terminal as `failed`.

## Composer Optimistic UI

`useCodex({ composer })` supports optimistic composer settings:

```tsx
const conversation = useCodex({
  composer: {
    optimistic: { enabled: true }, // assistant placeholder defaults to enabled
    onSend: async (text) => {
      await bridge.turns.send(text);
    },
  },
});
```

For custom optimistic logic, compose updates with:

- `createCodexOptimisticUpdate(...)`
- `codexOptimisticOps.insert / replace / remove / set / custom`

`CodexProvider` also supports optional sync hydration overlays for unsynced local conversations:

- pass `syncHydrationSource` into `CodexProvider`.
- `useCodex(...).messages` includes:
  - `syncProgress` with `syncedCount`, `totalCount`, `syncState`, and `label` (for example `12/20 synced`)
- local snapshot messages are shown immediately and reconciled against durable messages as sync completes.
- `syncProgress.syncState: "syncing"` is in-flight; send policy should block during this state for correctness.
- Sync hydration snapshots may also include durable `syncJobId`/policy metadata for stale-event gating.

## Runtime Bridge Lifecycle APIs

`createCodexHostRuntime(...)` exposes canonical lifecycle tracking as push + snapshot:

- `connect(args)`
- `subscribeLifecycle(listener)`
- `getLifecycleState()`

The lifecycle state includes:

- `running`
- `phase` (`idle|starting|running|stopping|stopped|error`)
- `source` (`runtime|bridge_event|protocol_error|process_exit`)
- `updatedAtMs`
- `conversationId` (Convex-owned conversation identity)
- `runtimeConversationId` (Codex runtime conversation identity)
- `conversationId`
- `turnId`

Tauri bridge client send behavior:

- Default: `createTauriBridgeClient(...)` keeps `turns.send(...)` fail-fast.
- Canonical sequence: `lifecycle.start(...)` (transport connect) -> `lifecycle.openThread(...)` (explicit thread intent) -> `turns.send(...)`.
- Opt-in: `createTauriBridgeClient(..., { lifecycleSafeSend: true })` only auto-recovers transport startup from cached `lifecycle.start(...)` config. It does not implicitly open/create threads.
- Tauri lifecycle readiness and open payloads are conversation-scoped only; legacy `threadId`/`localThreadId`/`persistedThreadId` aliases are not part of canonical package behavior.
- Fail-closed error codes for opt-in send:
  - `E_TAURI_SEND_START_CONFIG_MISSING`
  - `E_TAURI_SEND_AUTO_START_FAILED`
  - `E_TAURI_SEND_RETRY_EXHAUSTED`

## Runtime Sync Mapping APIs

Runtime-owned host definitions now expose explicit sync mapping mutations:

- `syncOpenConversationBinding`
- `markConversationSyncProgress`
- `forceRebindConversationSync`
- `startConversationSyncSource`
- `appendConversationSyncSourceChunk`
- `sealConversationSyncSource`
- `cancelConversationSyncJob`

Runtime-owned durable sync job read queries:

- `getConversationSyncJob`
- `listConversationSyncJobs`

These endpoints are used to persist local-runtime-to-Convex thread mapping state (`syncState`, `lastSyncedCursor`, session watermark, and rebind metadata) during `openThread` and ingest progression.
Sync mapping endpoints are required canonical host surface methods; missing sync methods fail closed (no `threads.resolve` compatibility fallback).

Runtime-owned host definitions also expose conversation-scoped archive mutations:

- `archiveConversation` (`actor`, `conversationId`)
- `unarchiveConversation` (`actor`, `conversationId`)

Conversation-scoped thread listing query:

- `listThreadsForConversation` (`actor`, `conversationId`, `includeArchived?`)

## Host Bounded Context Layout

Host internals are organized for same-branch multi-agent ownership:

- `src/host/contracts.ts`
- `src/host/definitions/**`
- `src/host/runtime/**`
- `src/host/persistence/**`
- `src/host/tooling.ts`

## Type Safety Checks

- `pnpm --filter @zakstam/codex-local-component run codegen:component`
- `pnpm --filter @zakstam/codex-local-component run lint`
- `pnpm --filter @zakstam/codex-local-component run typecheck`
- `pnpm --filter @zakstam/codex-local-component run typecheck:tsc`
- `pnpm --filter @zakstam/codex-local-component run schema:check`
- `pnpm --filter @zakstam/codex-local-component run check:unsafe-types`
- `pnpm --filter @zakstam/codex-local-component run check:host-boundaries`
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
