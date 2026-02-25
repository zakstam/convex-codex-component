# Tauri Example (Desktop + Convex Persistence)

This app is the blessed reference integration for production-grade React + Convex host wiring.
React hooks are the official recommendation for consumer integrations.

LLM onboarding entrypoint: `packages/codex-runtime/LLMS.md`.

Canonical wiring in this app centers on:
- `CodexProvider` + `useCodex`
- `useCodexRuntimeBridge`
- `useCodexThreadState`
- `useCodexTauriEvents` (single owner for Tauri runtime event subscriptions)
- generated host shim endpoints in `convex/chat.ts`

Canonical consumer implementation path:

- `packages/codex-runtime/LLMS.md`
- `packages/codex-runtime/docs/CANONICAL_INTEGRATION.md`

This README is app-specific operational guidance only; package docs are the integration source of truth.

## State Authority

- Runtime lifecycle signals must be sourced from `bridge.lifecycle.subscribe(...)` (package-owned contract).
- Use `bridge.lifecycle.getState()` as the snapshot fallback for reconciliation.
- `useCodexTauriEvents` is the only place that subscribes to Tauri bridge events.
- The hook is StrictMode-safe and deduplicates transition toasts to one toast per real running-state edge.
- App startup runs `chat.validatePickerHostWiring` before loading picker queries.
- If picker wiring validation fails, the app blocks picker reads and shows a clear remediation message (`pnpm --filter codex-runtime-tauri-example run dev:convex:once` + restart Tauri).
- This app uses explicit thread intent: `bridge.lifecycle.start(...)` (transport connect) then `bridge.lifecycle.openThread(...)` before `bridge.turns.send(...)`.
- This app also opts in to transport-only lifecycle-safe send recovery (`createTauriBridgeClient(..., { lifecycleSafeSend: true })`).
- Runtime auto-start is enabled when the app bootstraps actor identity; manual start remains available for recovery.
- Bridge helper shutdown is fail-closed: stdin/signal shutdown now has a forced timeout and a parent-process watchdog so orphaned helper runtimes self-terminate when the Tauri parent disappears.

## Tool Policy Panel

- Use the **Tool Policy** panel in the sidebar to block known dynamic tools for the current session.
- Toggle checks are mapped into a policy list and sent through `set_disabled_tools`.
- The runtime enforces the policy inside the bridge helper:
  - blocked tools are denied before any execution,
  - unknown tool names are rejected by the helper command handler.
- In this example, the known dynamic tool is `tauri_get_runtime_snapshot`.

## Runbook and Setup

- Shared run/check commands and required variables live in [packages/codex-runtime/docs/EXAMPLE_APPS_RUNBOOK.md](../../packages/codex-runtime/docs/EXAMPLE_APPS_RUNBOOK.md).
- Relevant section: `Tauri Example`.
- Create `apps/examples/tauri-app/.env.local` with `VITE_CONVEX_URL=...` and app-specific optional overrides as documented there.
- CI runs `pnpm --filter codex-runtime-tauri-example run typecheck` whenever host/type boundary paths change to protect generated `api.chat.*` contracts.

## Actor Security

- On first launch, the app prompts for a username and persists it in local storage.
- By default, actor lock is disabled and any username can be used.
- Set `TAURI_ACTOR_LOCK=1` in Convex server env to enable host binding and reject mismatched actor identities.
- On startup, the app reconciles to existing server-side lock/pin state (`chat.getActorBindingForBootstrap`) before loading thread data.
- Optional hard pin: set `ACTOR_USER_ID` in Convex server env to pin the accepted actor from startup.

## Raw Protocol Verification

To verify exactly what Codex emits before host parsing, run the Tauri helper with:

```bash
CODEX_BRIDGE_RAW_LOG=turns pnpm run dev
```

The helper prints raw stdin lines from `codex app-server` to stderr with prefix:

`[codex-bridge:raw-in] ...`

## Start Command Tracing

`start_bridge` emits structured diagnostics into `codex:global_message` so duplicate starts can be identified from one click:

- `kind: "bridge/start_trace"`
- `phase: "received"` and `phase: "result"`
- `traceId`, `tsMs`, `source` (for example `manual_start_button`, `composer_retry`)
- `runningBefore` and selected thread arguments

## Sync Debug Logging

For deep conversation-sync tracing (`partial`/stale hydration issues), enable both helper and UI debug channels:

```bash
CODEX_SYNC_DEBUG=1 pnpm run dev
```

In the browser DevTools console before reproducing:

```js
globalThis.__CODEX_SYNC_DEBUG__ = true;
```

This emits:
- helper-side `bridge/sync_debug` events and stderr `[sync-debug]` lines for import/job lifecycle
- client hydration acceptance/drop decisions (`drop_snapshot_stale_*`, `accept_snapshot`)
- React overlay merge accounting (`merge_snapshot_with_durable`)

## Bridge Command Contract

- Bridge command wiring is package-owned from `@zakstam/codex-runtime-bridge-tauri`.
- The app consumes `createTauriBridgeClient(...)`, helper command parsing, and helper ack policy from package exports.
- `pnpm run prepare:tauri-assets` regenerates Rust command/dispatch/invoke-handler files and permission TOML files from package-owned metadata.
- Generated Rust artifacts:
  - `src-tauri/src/bridge_contract_generated.rs`
  - `src-tauri/src/bridge_dispatch_generated.rs`
  - `src-tauri/src/bridge_invoke_handlers_generated.rs`
  - `src-tauri/permissions/autogenerated/*.toml`
- Rust command registration uses generated invoke handlers (`bridge_generate_handler!`) instead of a manually maintained command list in `src-tauri/src/main.rs`.
- Do not manually edit generated Rust bridge artifacts or permission files.

## ChatGPT Token Contract

When using ChatGPT auth token login/refresh flows, the payload now follows the latest app-server schema:

- `accessToken` (required)
- `chatgptAccountId` (required)
- `chatgptPlanType` (optional, nullable)

## Host Surface Ownership

- `convex/chat.ts`: generated app-owned public surface (`api.chat.*`) using `defineCodexHostDefinitions(...)` + explicit Convex `mutation/query` exports
- `convex/chat.extensions.ts`: app-owned endpoints (`listThreadsForPicker`, `listRuntimeConversationBindingsForPicker`, `getActorBindingForBootstrap`, `resolveOpenTarget`)
- Host shim drift is enforced with `pnpm run sync:host-shim` and `pnpm run check:host-shim`.

## Thread API

- Thread picker flow: `chat.listThreadsForPicker`.
- Picker payloads expose canonical persisted rows (`conversationId`, `preview`, status, timestamps).
- Local runtime-only thread visibility is opt-in (off by default) via the picker checkbox.
- When enabled, local threads are loaded immediately (and cleared immediately when disabled) and shown as `local unsynced` until a persisted binding exists.
- Local unsynced rows now use runtime-provided preview text when available (fallback: `Untitled thread`).
- Selecting a `local unsynced` thread now calls package runtime `importLocalThreadToPersistence(...)` so history is imported into Convex and shown immediately without sending a new turn.
- Successful local-thread sync now refreshes thread recency in runtime storage, so the newly persisted conversation appears in recency-sorted picker lists without UI-side promotion caches.
- Local-thread import sync is now modeled as a durable conversation-scoped job (`idle -> syncing -> synced|failed|cancelled`) with persisted `syncJobId` metadata.
- UI hydration updates are gated by `syncJobId` to avoid stale job overwrite.
- Send policy is explicit: message sends are blocked while the selected conversation sync job is `syncing`.
- Runtime-owned `ensureConversationBinding` is single-path and requires `conversationId`.
- Sync engine host hooks are explicit: `chat.syncOpenConversationBinding`, `chat.markConversationSyncProgress`, `chat.forceRebindConversationSync`.
- Durable sync-job hooks are explicit: `chat.startConversationSyncSource`, `chat.appendConversationSyncSourceChunk`, `chat.sealConversationSyncSource`, `chat.cancelConversationSyncJob`, `chat.getConversationSyncJob`, `chat.listConversationSyncJobs`.
- Bridge lifecycle state distinguishes `conversationId` (Convex) and `runtimeConversationId` (Codex runtime).

Additional cleanup endpoints:

- `chat.deleteThread`
- `chat.scheduleDeleteThread`
- `chat.deleteTurn`
- `chat.scheduleDeleteTurn`
- `chat.purgeActorData`
- `chat.schedulePurgeActorData`
- `chat.cancelDeletion`
- `chat.forceRunDeletion`
- `chat.getDeletionStatus`

The Data cleanup panel schedules deletions with a grace window (10 minutes by default), allows undo/cancel before execution, and includes a force-run action to execute immediately.
