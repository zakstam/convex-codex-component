# @convex-dev/codex-local-component

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
