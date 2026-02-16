# @zakstam/codex-local-component

## 0.15.1

### Patch Changes

- 316e5d0: Fix `withServerActor` to preserve the request actor's userId for runtime-owned profiles. Previously, when `serverActor` had no `userId` (the default for runtime-owned endpoints), the request actor was unconditionally replaced with the empty server actor, causing all component data to be scoped under the anonymous user scope. Now the request actor is preserved when the server actor has no `userId`, so preset mutations and queries correctly scope data to the authenticated user.

## 0.15.0

### Minor Changes

- 87c154d: Improve host integration surface based on external API audit.
  - Add `lastEventCursor` arg to `ensureSession` preset mutation (was silently hardcoded to 0).
  - Rename `ensureThread` preset arg from `threadId` to `localThreadId` to match `HostRuntimePersistence` interface.
  - Export `isTurnNotFound` error classifier from `./host/convex`.
  - Re-export `upsertTokenUsageForActor`, `listTokenUsageForHooksForActor`, `hasRecoverableIngestErrors` from `./host/convex`.
  - Export `vManagedServerRequestMethod` and `vServerRequestId` validators from `./host/convex`.

## 0.14.1

### Patch Changes

- 7c0a0d1: Simplify actor-locked host wiring for external consumers.
  - Add `defineGuardedRuntimeOwnedHostEndpoints(...)` to `@zakstam/codex-local-component/host/convex` so consumers can apply mutation/query actor guards once instead of wrapping each exported endpoint manually.
  - Add `guardRuntimeOwnedHostDefinitions(...)` for teams that already build runtime-owned defs and want to apply guard policy as a final step.
  - Update host integration docs and API reference with the guarded runtime-owned wiring path.
  - Migrate the Tauri example `convex/chat.ts` to the guarded helper and reduce repeated actor-resolution boilerplate in custom endpoints.

- fabdc3a: Refactor across component source, config, and example apps.
  - Extract shared deletion utilities (UUID generation, delay clamping, deleted-counts parsing) into `deletionUtils.ts`, removing 3 sets of duplicated functions from `threads.ts`, `turns.ts`, and `deletionInternal.ts`.
  - Split `threads.ts` by extracting validators into `threadValidators.ts` and internal helpers into `threadHelpers.ts`, reducing the file from 850 to 632 lines.
  - Replace all `void error;` silent error swallowing (6 occurrences) with `console.warn` for debuggability.
  - Expand ESLint config with `no-unused-vars`, `no-floating-promises`, and `prefer-const` rules; fix all violations.
  - Add `@types/react` as optional peer dependency to match the existing `react` peer dep pattern.

## 0.14.0

### Minor Changes

- 275a7d5: Refactor runtime and component internals to reduce implicit state handling, normalize terminal statuses, and centralize shared contracts.
  - Normalize runtime terminal mapping to canonical `interrupted` status (instead of `cancelled`) for turn completion handling.
  - Extract sync validators into a dedicated `component/validators` module to reduce inline validator sprawl in endpoint files.
  - Replace string-concatenated ingest cache keys with nested map structures keyed by turn and id.
  - Centralize repeated numeric limits into shared constants and apply them across thread snapshot reads, deletion scans, and runtime idle flush scheduling.
  - Add coded not-found errors (`E_THREAD_NOT_FOUND`, `E_TURN_NOT_FOUND`, `E_STREAM_NOT_FOUND`) and improve auth error messaging consistency.
  - Centralize thread snapshot query loading via a repository helper to reduce scattered inline query logic.

### Patch Changes

- 761ec1a: Refactor component internals and example hosts to reduce duplication and tighten architecture boundaries.
  - Align Convex dependency baseline to `^1.31.7` for the published component package and release smoke host.
  - Deduplicate CLI/smoke host protocol parsing and notification/response guards via `apps/shared/protocolPayload.ts`.
  - Deduplicate Convex URL resolution in example hosts via `apps/shared/resolveConvexUrl.ts`.
  - Simplify approvals pending-list query construction by centralizing shared pagination state.
  - Consolidate deletion batch execution flow with shared batch-step runner logic.
  - Split ingest module typing into slice-scoped context types (turn/message/approval/stream/checkpoint/session) to reduce monolithic `IngestContext` coupling.

## 0.13.4

### Patch Changes

- f3d07b3: Fix the send lifecycle gap by durably accepting turns before runtime dispatch and reconciling accepted sends to a terminal state on runtime failure.
  - Add two-phase host send contract (`acceptTurnSend` + `failAcceptedTurnSend`) and make `runtime.sendTurn(...)` await durable accept.
  - Reconcile accepted sends on dispatch and handler failure paths so turns do not remain non-terminal.
  - Fail closed on missing-thread reads in message listing by returning an empty page.
  - Update host integration docs and Tauri reference helper wiring for the new persistence contract.

## 0.13.3

### Patch Changes

- 4d851eb: Contain generated Convex typing looseness at a single host-internal boundary.
  - Add `src/host/generatedTypingBoundary.ts` to normalize host component refs without leaking casts into handwritten host/runtime flows.
  - Refactor `defineCodexHostSlice` to use the shared boundary resolver and remove inline component-cast plumbing.
  - Update client/API docs to clarify that generated component typing gaps are internalized so external consumers do not need casts.

- 755448c: Fix host component ref normalization to support proxy-like `components` objects that expose `codexLocal` via property get traps. This prevents runtime failures when resolving thread mutations in external consumer integrations.

## 0.13.2

### Patch Changes

- acbe424: Improve external consumer type-safety across React hooks and adapter contracts.
  - Add generic callback-result inference to `useCodexConversationController`, `useCodexChat`, and `createCodexReactConvexAdapter(...).useConversationController(...)` for `composer`, `approvals`, `interrupt`, and dynamic-tool `respond` handlers.
  - Add generic result inference to `useCodexThreads` controls (`createThread`, `resolveThread`, `resumeThread`) to reduce downstream casts.
  - Harden `useCodexDynamicTools` against non-matching query payloads by deriving calls only from validated server-request rows.
  - Tighten host preset definitions by making preflight checks explicitly `Promise<void>` and adding an explicit `returns` validator for `ensureThread`.
  - Update React/client docs and API reference to reflect the stronger consumer typing contracts.

- b3c5b87: Harden linting coverage and expose lint scripts across the published package and app surfaces.
  - Add a workspace `lint` script in `package.json` targeting only intended TS/TSX source trees and switch release prechecks to use it.
  - Expand root ESLint target files to include the Tauri example and component package sources, plus TSX files.
  - Add explicit root excludes for `submodules/**`, `**/src-tauri/**`, `**/target/**`, and generated bundle assets.
  - Add `lint` scripts to `packages/codex-local-component` and `apps/examples/tauri-app`.
  - Update docs to reflect the new lint commands in onboarding and app checks.

- acbe424: Improve React hook typing so external consumers can avoid manual casts.
  - Add generic callback-result inference to `useCodexAccountAuth` and `useCodexRuntimeBridge`.
  - Remove repeated per-hook `OptionalRestArgsOrSkip` cast patterns by centralizing query-arg conversion in one helper.
  - Remove the `useCodexConversationController` fallback cast when deriving the dynamic-tools query source.
  - Update React/client docs and API reference to reflect the stronger consumer-facing type contracts.

## 0.13.1

### Patch Changes

- 4110cf7: Add a package-scoped `coverage` script for local coverage runs:
  - Add `coverage` to `packages/codex-local-component/package.json`:
    `pnpm run build && NODE_V8_COVERAGE=coverage node --test --experimental-test-coverage test/*.test.mjs`
  - Lets contributors run `pnpm --filter @zakstam/codex-local-component run coverage` without CI wiring.

## 0.13.0

### Minor Changes

- c782976: Beta architecture restructure: remove dispatch-managed mode, eliminate client passthrough layer, consolidate export paths (11 to 7), split oversized files, simplify React hook surface.

  Breaking changes:
  - Removed `./client` export path (use default import or `./host/convex`)
  - Removed `./errors` export path (use default import)
  - Removed `./bridge` export path (use `./host`)
  - Removed `./app-server` export path (use `./host`)
  - Removed dispatch-managed mode (use runtime-owned exclusively)
  - Removed `useCodexComposer`, `useCodexApprovals`, `useCodexInterruptTurn`, `useCodexAutoResume` hooks
  - `useCodexConversationController` is no longer publicly exported (use `useCodexChat`)
  - Removed `codex_turn_dispatches` table from schema

- 056f25e: Add a Tauri example Tool Policy panel and bridge support for disabling dynamic tools at runtime.

  The new UI in the Tauri example allows blocking named dynamic tools from the sidebar. The bridge now accepts `set_disabled_tools` from Rust/React, synchronizes the policy in bridge state, and enforces it in the helper before invoking any dynamic tool execution.

- 056f25e: Add a new high-level `useCodexChat` hook as a dedicated conversation facade for UI consumers.
  The new API wraps `useCodexConversationController`, preserves existing surface behavior, and adds explicit tool policy controls for disabling tools and overriding tool handlers. Update docs and the blessed Tauri example to reference the new hook.

### Patch Changes

- 92741ec: Remove dispatch-managed mode handling from the host runtime API and align tests/examples to runtime-owned dispatch only.
  `createCodexHostRuntime().start` no longer accepts a `dispatchManaged` flag, `startClaimedTurn` has been removed from runtime usage, and Tauri example wiring now uses shared dynamic-tool constants.
- b716998: Improve external consumer onboarding docs in the published package:
  - Keep `packages/codex-local-component/README.md` as the human entrypoint.
  - Keep `packages/codex-local-component/LLMS.md` as the LLM-only routing manifest.
  - Add a copy-paste one-shot prompt for external users to give an LLM and get setup flowing end-to-end.
  - Add onboarding metadata (`description` and `codex.onboarding.prompt`) in package manifest so npm discoverability includes the same external onboarding flow.
  - Add the same LLM handoff prompt to monorepo `README.md` for external consumers.

## 0.12.1

### Patch Changes

- 57f0d3c: Replace the long API reference with a shorter consumer-first map that highlights recommended import paths and only high-signal, importable APIs.
  Add a docs check to verify every documented API exists in the package export surface.

## 0.12.0

### Minor Changes

- 8769211: Adopt helper-first host wiring for consumers so host endpoints are defined directly in `convex/chat.ts` using `defineRuntimeOwnedHostEndpoints` / `defineDispatchManagedHostEndpoints`.

  This removes consumer dependency on generated `chat.generated.ts` surfaces and updates examples, smoke host wiring, docs, and scripts to use the direct helper workflow.

## 0.11.0

### Minor Changes

- fef7ba2: Add async cascade deletion APIs for Codex persisted data with job-based status tracking.

  New public component endpoints:
  - `threads.deleteCascade`
  - `threads.scheduleDeleteCascade`
  - `turns.deleteCascade`
  - `turns.scheduleDeleteCascade`
  - `threads.purgeActorData`
  - `threads.schedulePurgeActorData`
  - `threads.cancelScheduledDeletion`
  - `threads.forceRunScheduledDeletion`
  - `threads.getDeletionJobStatus`

  Add matching typed client helpers:
  - `deleteThreadCascade`
  - `scheduleThreadDeleteCascade`
  - `deleteTurnCascade`
  - `scheduleTurnDeleteCascade`
  - `purgeActorCodexData`
  - `schedulePurgeActorCodexData`
  - `cancelScheduledDeletion`
  - `forceRunScheduledDeletion`
  - `getDeletionJobStatus`

  Deletion runs in paged internal jobs and reports scheduled/queued/running/completed/failed/cancelled states.

### Patch Changes

- 6418730: Document that `@zakstam/codex-local-component` is now in alpha and ready for active testing (still not production ready), and update release safety allowlists so CI prechecks stay green after recent refactors.
- 198fa00: Fix host surface generation for dispatch-managed Tauri consumers by preserving app-owned `convex/chat.ts` entry modules and requiring a deterministic `actor.userId` fallback in generated wiring smoke scripts.
- c7836e6: Enforce Convex reference integrity across persisted Codex state tables by adding canonical `v.id(...)` relationships (thread/turn/stream refs), wiring write paths to populate and validate those refs, and keeping cascade delete behavior as the default cleanup model.

  Also canonicalize runtime turn ids before side-channel persistence and add bounded retry behavior for pending server request writes that race ahead of turn persistence.

- 198fa00: Fix two host-facing persistence failure paths: `sync.ensureSession` now rebinds an existing session to the requested thread for the same actor instead of throwing `E_SYNC_SESSION_THREAD_MISMATCH`, and `dispatch.markTurnStarted` now treats invalid/missing claim tokens as a no-op so dispatch state stays unchanged without an uncaught mutation error.

## 0.10.3

### Patch Changes

- f64ea1e: Align ChatGPT auth-token response/request handling with the latest Codex app-server schema by replacing `idToken` payload usage with `chatgptAccountId` and optional `chatgptPlanType`, while keeping `accessToken` as required.
- bba191a: Fix risky fallback defaults across the component: use `??` instead of `||` for text overlay to preserve empty strings, fix operator precedence in batch limit calculation, explicitly set status on serialized messages, simplify dead-code `threadId ?? userId!` to `threadId`, and centralize `streamsInProgress` default to a single normalization point.
- bba191a: Fix turn-id canonicalization for ingest and legacy envelopes:
  - Ignore legacy `codex/event/*` envelope `params.id` when extracting turn ids (accept only explicit `msg.turn_id` / `msg.turnId`).
  - During ingest normalization, prefer payload-derived turn ids and fail closed when lifecycle payloads do not carry a canonical turn id, so synthetic turn `"0"` cannot be materialized.
  - Add a release-smoke package freshness check that fails if an installed package still contains legacy `params.id` turn-id fallback logic.
- bba191a: Add bridge-level raw app-server ingress logging behind `CODEX_BRIDGE_RAW_LOG` (`all` or `turns`) so hosts can verify exact pre-parse protocol lines.

  Also harden runtime turn-id mapping so runtime-emitted ids can be remapped to persisted claimed turn ids before ingest persistence.

- bba191a: Harden host ingest turn-id authority and mixed-mode ingest contracts.
  - Reject `codex/event/*` ingest entries that do not carry canonical payload turn id (`msg.turn_id` or `msg.turnId`).
  - Reject `turn/started` and `turn/completed` stream deltas when canonical payload turn id is missing.
  - Remove mixed-mode untyped ingest coercion and require explicit typed ingest envelopes (`stream_delta` or `lifecycle_event`).
  - Add safe ingest error mapping/code for missing canonical legacy turn id.
  - Add safe ingest error mapping/code for missing canonical turn lifecycle payload turn id.
  - Update host docs and tests to reflect strict typed ingest and fail-closed legacy turn-id behavior.

## 0.10.2

### Patch Changes

- de1fb4b: Fix `useCodexThreadActivity` stale-streaming precedence so stale `streaming` messages do not override newer terminal boundaries from completed/failed/interrupted signals.

## 0.10.1

### Patch Changes

- 690e92a: Unify terminal turn artifact reconciliation behind a single internal mutation path and make activity authority terminal-boundary decisions timestamp-aware (`completedAt/updatedAt` before `createdAt`).

  Also update `threadSnapshotSafe` contract/docs to include terminal-aware timestamp invariants used by activity hooks.

## 0.10.0

### Minor Changes

- f958db5: Add per-turn token usage tracking and inline display in the tauri example app
  - New component-level `tokenUsage` module with `upsert` mutation and `listByThread` query
  - New `useCodexTokenUsage` React hook and `CodexTokenUsage` / `CodexTokenUsageBreakdown` types exported from `react` entrypoint
  - Host preset wires `upsertTokenUsageForHooks` mutation and `listTokenUsageForHooks` query
  - Tauri app shows a compact per-turn token label (total / in / out) beneath the last assistant message of each turn

### Patch Changes

- c079fde: Make streaming activity authority deterministic across modes and stream cleanup timing
  - Move thread/branch activity to a shared authority module with explicit precedence:
    pending approvals > streaming message > active stream > in-flight newer than terminal > terminal > idle
  - Treat `activeStreams` as authoritative for stream-state-driven streaming and prevent stale `streamStats` rows from forcing streaming when no active stream exists
  - Emit a canonical `stream/drain_complete` lifecycle marker when stream cleanup fully drains and consume it in activity derivation to exit streaming promptly
  - Harden stream stat hygiene with monotonic state transitions and stale streaming-stat finalization when no matching active stream exists
  - Add parity tests covering identical activity transitions for dispatch-managed and runtime-owned scenarios, including delayed/stale stream stats

## 0.9.1

### Patch Changes

- 26d9648: Fix thread activity phase stuck on "streaming" after turn completion

  `deriveCodexThreadActivity` now compares in-flight dispatch/turn timestamps against the latest terminal message (completed/failed/interrupted). Stale orchestration records that lag behind a more recent terminal message no longer keep the phase as "streaming", allowing it to correctly fall through to "idle" or the appropriate terminal state.

## 0.9.0

### Minor Changes

- e5895a8: Add a high-level `useCodexConversationController` React hook that bundles messages, activity, ingest health, branch activity, composer, and interrupt state/actions.

  Promote React hooks as the official integration recommendation, expose controller support in the React+Convex adapter, and document the Tauri app as the blessed reference wiring.

  Harden host runtime ingest flushing by treating `ingestSafe` rejections with only `OUT_OF_ORDER` errors as non-fatal dropped batches, preventing repeated protocol flush failures.

- a9d5a68: Expand React-first integration coverage with new first-class hooks:
  - `useCodexDynamicTools` (plus dynamic tool payload/call derivation helpers)
  - `useCodexRuntimeBridge`
  - `useCodexAccountAuth`
  - `useCodexThreads`

  Also extend `useCodexConversationController` to bundle dynamic tool handling and update React integration/docs to reflect the hook-first canonical path.

## 0.8.0

### Minor Changes

- cbdd290: Hardened runtime and protocol error handling to fail closed instead of silently defaulting, with explicit terminal/runtime error codes and stricter parsing for terminal events, managed server requests, keyset cursors, and stored server-request questions.

  Added CI enforcement via `check:error-discipline` to block common silent-error patterns (empty catches, swallowed rejection chains, and legacy terminal fallback literals), plus expanded test coverage for malformed payload and strict-cursor scenarios.

### Patch Changes

- 35259d6: Align host-side ingest recoverability handling with the component contract by using the server-provided `errors[].recoverable` signal.
  - add a shared host utility for recoverable ingest error detection
  - remove Tauri example's hardcoded `OUT_OF_ORDER`/`REPLAY_GAP` session rollover fallback
  - prevent false `sync/session_rolled_over` warnings for non-recoverable ingest failures

## 0.7.1

### Patch Changes

- 63614d4: Refactor scope contracts to support optional `userId` actor handling across component and host integrations.

## Unreleased

### Major Changes

- Refactor actor scoping contract from required `tenantId/userId/deviceId` to optional `userId` only (`actor: { userId?: string }`) across component, host runtime, generated surfaces, examples, and smoke apps.
  - Enforce user-scope normalization internally so identified users are isolated to their own rows and omitted `userId` is isolated to anonymous-only rows.
  - Remove tenant/device scoping fields, filters, and related schema/index usage from component query/auth/session/checkpoint paths.
  - Remove ingest-safe `SESSION_DEVICE_MISMATCH` handling and device-mismatch session guard logic.
  - Update runtime dispatch claim-owner sourcing away from `actor.deviceId` to runtime-local ownership identifiers.
  - Regenerate host surfaces and dependent app/generated Convex bindings to the new actor contract.
  - Update canonical docs and host integration references to `actor: { userId?: string }` semantics.
  - Forward-only rollout: no backward-compat shims and no data migration layer; existing deployments with legacy rows require reset/cleanup before strict schema validation passes.

## 0.7.0

### Minor Changes

- 5badeb0: Introduce manifest-driven host surface generation and canonical single-path integration docs.
  - Generate host `convex/chat.generated.ts` wrappers from a canonical preset manifest and keep app-owned endpoints in `chat.extensions.ts`.
  - Add host surface generation/check tooling (`host:generate`, `host:check`) and shared wiring smoke checks across example and smoke hosts.
  - Add host preset matrix generation + snapshot/contract tests for key parity across runtime-owned and dispatch-managed surfaces.
  - Standardize docs around a single canonical consumer strategy in `LLMS.md` (runtime-owned default) with explicit advanced appendix boundaries.
  - Add docs drift guardrail (`check:docs:single-path`) and include canonical docs files in package publish contents.

## 0.6.0

### Minor Changes

- 909e75c: Make dispatch ownership explicit in host runtime with mode-gated APIs and stronger orchestration guardrails.
  - Require `dispatchManaged: true | false` in `createCodexHostRuntime().start(...)`.
  - Split turn entrypoints by ownership mode:
    - `sendTurn(...)` for runtime-owned orchestration (`dispatchManaged: false`)
    - `startClaimedTurn(...)` for externally claimed dispatch execution (`dispatchManaged: true`)
  - Add explicit runtime dispatch error codes for mode conflicts, invalid claims, in-flight turn conflicts, and missing mode.
  - Add `normalizeInboundDeltas(...)` host helper and apply canonical inbound normalization before strict ingest.
  - Add unified dispatch observability projection helpers (queue + claim + runtime + turn + correlation IDs).
  - Extend dispatch state with `claimToken` and update smoke/example wrappers to the explicit ownership contract.
  - Add runtime-mode coverage in host/runtime and host/wrapper tests.
  - Publish separate reference docs for runtime-owned and dispatch-managed modes.

## 0.5.0

### Minor Changes

- 92ed5a0: Refactor host helper APIs to remove implicit trusted-actor behavior and make actor injection explicit in host apps.
  - Rename host helper exports from `*WithTrustedActor` to `*ForActor`.
  - Remove `trustedActorFromEnv` export from host helper surfaces.
  - Update example and smoke host wrappers to pass an explicit server actor for trusted execution paths.
  - Fix server-request upsert/resolve matching by keying on `requestIdType + requestIdText` and add the corresponding schema index.
  - Update host slice tests to match renamed helper APIs.
  - Harden TypeScript safety across host/client/react/protocol paths by removing explicit `any` usage and tightening generic boundaries.
  - Add `check:unsafe-types` CI guard plus cast allowlist maintenance script for handwritten source.
  - Update integration docs to clarify Convex-safe protocol usage (`protocol/parser` is local runtime only; do not import it in Convex-deployed code).

- 180533b: Add a first-class host dispatch queue contract with atomic claim + lease semantics for deterministic turn execution ownership.
  - Add `dispatch` component APIs: `enqueueTurnDispatch`, `claimNextTurnDispatch`, `markTurnStarted`, `markTurnCompleted`, `markTurnFailed`, `cancelTurnDispatch`, and `getTurnDispatchState`.
  - Introduce persisted dispatch lifecycle state (`queued | claimed | started | completed | failed | cancelled`) and lease reclaim behavior to eliminate silent "accepted but never executed" gaps.
  - Update host runtime to use enqueue-first turn send flow with claim-loop dispatching and explicit dispatch state transitions on start, completion, and failure.
  - Remove synthetic scheduled turn execution startup path that assumed ownership before runtime confirmation.
  - Add host/client wrapper exports for dispatch operations and migrate example/smoke wrappers to dispatch-based send paths.
  - Extend thread state diagnostics with dispatch visibility and update integration/operations/react docs for the canonical dispatch contract.

## 0.4.0

### Minor Changes

- b3c3e66: Add host runtime ingest diagnostics via `getState().ingestMetrics`, including enqueued/skipped totals and per-event-kind counters, and propagate diagnostics through the Tauri example bridge/status surfaces for idle ingest debugging.
- 50f507e: Add typed account/auth helper APIs across app-server and host runtime (`account/read`, login/cancel/logout, rate-limits read, and ChatGPT token-refresh response handling), with updated docs/tests and Tauri example wiring for end-to-end auth controls.

## 0.3.0

### Minor Changes

- 3634658: Add full app-server thread lifecycle support to the package runtime and helpers.
  - Add typed app-server builders for `thread/resume`, `thread/fork`, `thread/read`, `thread/list`, `thread/loaded/list`, `thread/archive`, `thread/unarchive`, and `thread/rollback`.
  - Extend `createCodexHostRuntime` with startup strategies (`start`/`resume`/`fork`) and runtime thread lifecycle methods.
  - Expand `@zakstam/codex-local-component/client` thread helper exports (`createThread`, `resolveThread`, `resumeThread`, `resolveThreadByExternalId`, `getExternalThreadMapping`, `listThreads`).
  - Add lifecycle-focused runtime and helper test coverage and documentation updates.

- b0f3d69: Add first-class reasoning stream support across the component, client, host wrappers, and React hooks.
  - Parse and normalize `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, and `item/reasoning/textDelta` into canonical reasoning deltas.
  - Persist reasoning segments (`codex_reasoning_segments`) and expose paginated reasoning queries.
  - Add dedicated consumer APIs: `listReasoningByThread`, `useCodexReasoning`, and `useCodexStreamingReasoning`.
  - Add sync runtime controls: `saveReasoningDeltas` (default `true`) and `exposeRawReasoningDeltas` (default `false`).
  - Update host helpers/docs and Tauri example integration so reasoning can be surfaced in chat flow with distinct reasoning styling.

### Patch Changes

- 57ef44d: Refactor sync ingest into a staged internal pipeline under `src/component/ingest` and keep `syncIngest.ts` as a thin facade.

  Add targeted ingest pipeline tests for normalization, turn signal collection, and ingest-safe error classification.

- 78b7fc7: Add shared host Convex wrapper primitives and validators to reduce duplicated `convex/chat.ts` logic across example/smoke apps.

  Add a Node-safe host entrypoint (`@zakstam/codex-local-component/host/convex`) so Convex server files can import host helpers without pulling Node runtime bridge code into Convex bundling.

  Migrate example/smoke host wrapper files and docs to the shared Convex host helpers and the new Convex-safe import path.

- 403437a: Adjust command-execution durable message text to store the command string rather than aggregated command output.

  This supports UIs that show tool-call identity (for example, the command that was run) while suppressing tool output/result text from the chat flow.

- d6a6ce3: Refactor protocol message handling to use canonical event parsing while remaining resilient to valid unknown JSON-RPC shapes from `codex app-server`.

  Update host/runtime and example bridges to align on the new protocol helpers, and suppress non-fatal unsupported-shape protocol noise in the Tauri example bridge state.

  Refresh examples and host integration docs to match the new ingest/runtime flow.

- afd81f7: Add end-to-end server-request handling for app-server approval and user-input flows.

  Persist pending server requests (command approvals, file change approvals, tool user input) through host runtime persistence hooks and expose typed host/client wrappers.

  Wire the Tauri example to list, triage, and resolve pending server requests from Convex, and update host integration/docs/tests to match the new contract.

- ebe936f: Add dynamic tool call response handling and thread-identity boundary hardening for host runtimes.
  - Add typed `item/tool/call` response support in protocol/runtime paths and host docs.
  - Enable dynamic tools in the Tauri example with `tauri_get_runtime_snapshot` and local pending-request introspection.
  - Clarify and enforce `runtimeThreadId` (app-server) vs `localThreadId` (Convex) across bridge state and UI.
  - Stabilize stream overlay state updates to avoid repeated render loops from unchanged delta payloads.

## 0.2.1

### Patch Changes

- Fix app-server thread ID handling for runtime turns by accepting UUID-like thread IDs and improving runtime thread-id resolution across host and Tauri bridge flows.

## 0.2.0

### Minor Changes

- ce21324: Refactor sync APIs and consumer helpers for clearer ingest/replay semantics.

  ### Highlights
  - Rename sync component APIs to `ingest`, `replay`, `resumeReplay`, `listCheckpoints`, `upsertCheckpoint`
  - Rename client helpers to `replayStreams` and `resumeStreamReplay`
  - Add typed `@zakstam/codex-local-component/app-server` entrypoint
  - Improve stream replay metadata (`streamWindows`, `nextCheckpoints`)
  - Add keyset pagination baseline for durable message listing
  - Add Tauri end-to-end example app and update integration docs

## 0.1.3

### Patch Changes

- 5d00d46: Fix Node ESM compatibility for protocol and bridge imports by adding JSON import attributes in the protocol parser and using an explicit `./v2/index.js` export path in protocol schemas.

## 0.1.2

### Patch Changes

- 0966382: Migrate package scope from `@convex-dev/codex-local-component` to `@zakstam/codex-local-component` and update all consumer imports, docs, and release smoke checks.

  Add explicit npm publish configuration for public scoped publishing.

## 0.1.1

### Patch Changes

- 1638598: Fix package release integrity by including required generated component files, resolving strict TypeScript status-priority typing in message mapping, and using a CI-safe test glob in package test scripts.
- 806e57f: Initial release of `@convex-dev/codex-local-component` with local Codex bridge,
  Convex component APIs, typed client/react helpers, and release smoke host coverage.
