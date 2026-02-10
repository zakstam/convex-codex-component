# @convex-dev/codex-local-component

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
