# API Reference

This package documents one integration path only.
Canonical default: runtime-owned host integration.
If setup drifts, treat it as an integration error and run the doctor check.

Use this path in order:

1. Mount `@zakstam/codex-local-component/convex.config`.
2. Define host definitions via `defineCodexHostDefinitions(...)` from `@zakstam/codex-local-component/host/convex`.
3. Export explicit Convex `query/mutation` handlers from `convex/chat.ts`.
4. Start runtime with `createCodexHostRuntime(...)` from `@zakstam/codex-local-component/host`.
5. Build UI with hooks from `@zakstam/codex-local-component/react`.

## `@zakstam/codex-local-component`

| `API` | `Type` | `Notes` |
| --- | --- | --- |
| `createCodexHostRuntime` | `function` | Runtime-owned host runtime factory. |
| `defineCodexHostDefinitions` | `function` | Runtime-owned host definition builder. |
| `createConvexPersistence` | `function` | Convex-backed persistence adapter for host runtime. |

## `@zakstam/codex-local-component/react`

| `API` | `Type` | `Notes` |
| --- | --- | --- |
| `CodexProvider` | `component` | React provider for host API + actor context. |
| `useCodex` | `hook` | Canonical high-level hook for conversation/runtime. |
| `useCodexRuntimeBridge` | `hook` | Runtime bridge controls/state for host-driven UIs. |
| `useCodexOptimisticMutation` | `hook` | Wraps `useMutation(...).withOptimisticUpdate(...)` with strict codex typing. |
| `createCodexOptimisticUpdate` | `function` | Compose optimistic operations into one update callback. |
| `codexOptimisticOps` | `object` | Generic optimistic operations: `insert`, `replace`, `remove`, `set`, `custom`. |
| `codexOptimisticPresets` | `object` | Codex presets for optimistic message send and deletion-status updates. |
| `CodexSyncHydrationSource` | `type` | Optional provider source for local unsynced message hydration overlays. |
| `CodexSyncHydrationSnapshot` | `type` | Conversation-scoped local snapshot (`messages`, `syncState`, `updatedAtMs`). |
| `CodexConversationSyncProgress` | `type` | Conversation-level sync summary (`syncedCount`, `totalCount`, `syncState`, `label`). |

## `@zakstam/codex-local-component/host`

| `API` | `Type` | `Notes` |
| --- | --- | --- |
| `createCodexHostRuntime` | `function` | Runtime owner for Codex bridge + persistence loop. |
| `defineCodexHostDefinitions` | `function` | Host definition source used by app `convex/chat.ts`. |
| `renderCodexHostShim` | `function` | Deterministic host shim renderer for `sync/check` scripts. |

## `@zakstam/codex-local-component/host/convex`

| `API` | `Type` | `Notes` |
| --- | --- | --- |
| `defineCodexHostDefinitions` | `function` | Returns runtime-owned mutation/query definitions. |
| `resolveActorFromAuth` | `function` | Canonical actor helper that binds authenticated identity to `actor.userId` and preserves `actor.anonymousId` when auth identity is absent. |
| `HOST_SURFACE_MANIFEST` | `const` | Canonical host mutation/query surface metadata. |
| `renderCodexHostShim` | `function` | Generates explicit Convex `convex/chat.ts` module content. |
| `vHostActorContext` | `validator` | Actor validator for host endpoints. |

## `@zakstam/codex-local-component/protocol`

| `API` | `Type` | `Notes` |
| --- | --- | --- |
| `parseWireMessage` | `function` | Parse inbound protocol wire lines/messages. |
| `assertValidClientMessage` | `function` | Validate outbound client wire payloads. |
| `classifyMessage` | `function` | Classify inbound protocol messages into thread/global scopes. |

## `@zakstam/codex-local-component/convex.config`

| `API` | `Type` | `Notes` |
| --- | --- | --- |
| `default` | `component` | Convex component mount entrypoint. |

## Notes

- `defineCodexHostDefinitions` is the canonical host-definition entrypoint.
- `createCodexHost` and wrapper-based host facade APIs are removed.
- Authentication is consumer-managed at app boundaries.
- Host definitions preserve consumer actor identity: request actor identity is passed through when present; anonymous calls use the configured host fallback actor.
- Canonical actor shape at host/runtime boundaries: `actor: { userId?: string; anonymousId?: string }`.
- Runtime-owned default anonymous actor uses generated per-session `anonymousId`.
- Canonical bridge lifecycle contract is push + snapshot:
  - runtime: `subscribeLifecycle(listener)` + `getLifecycleState()`
  - Tauri client: `bridge.lifecycle.subscribe(listener)` + `bridge.lifecycle.getState()`
  - lifecycle fields include `running`, `phase`, `source`, `updatedAtMs`, `conversationId`, `runtimeConversationId`, and `turnId`.
- Runtime start contract is split:
  - `connect(...)`: transport/session only
  - `openThread({ strategy, conversationId? })`: explicit conversation start/resume/fork
  - `importLocalThreadToPersistence({ runtimeThreadHandle, conversationId? })`: canonical single-call local-thread import into persistence
  - large imports adaptively split ingest batches on Convex document-read-limit rejections while preserving event order
  - `sendTurn(...)` fails closed until `openThread(...)` succeeds.
- Tauri send behavior:
  - canonical sequence: `bridge.lifecycle.start(...)` -> `bridge.lifecycle.openThread(...)` -> `bridge.turns.send(...)`.
  - default (`createTauriBridgeClient(...)`): `bridge.turns.send(...)` remains fail-fast.
  - opt-in (`createTauriBridgeClient(..., { lifecycleSafeSend: true })`): transport auto-start retry only; does not implicitly open/create threads.
  - lifecycle-safe send typed failures:
    - `E_TAURI_SEND_START_CONFIG_MISSING`
    - `E_TAURI_SEND_AUTO_START_FAILED`
    - `E_TAURI_SEND_RETRY_EXHAUSTED`
- Export Convex host functions as named constants in `convex/chat.ts` to keep generated `api.chat.*` contracts stable.
- Runtime-owned `ensureConversationBinding` is single-path and requires `conversationId`.
- Conversation-scoped query exports are safe-by-default and return thread-read status payloads (`threadStatus`, `code`, `message`) for handled read failures. `listPendingServerRequests` returns an empty list on missing-thread reads to keep runtime request polling consumers on a stable array contract.
- External identifier read aliases are also available:
  - `threadSnapshotByConversation`
  - `listThreadMessagesByConversation`
  - `listTurnMessagesByConversation`
  - `listPendingServerRequestsByConversation`
  These use `conversationId` as the public identity while preserving runtime-owned persistence mapping internally.
- Runtime-owned lifecycle endpoints: `deleteThread`, `scheduleDeleteThread`, `deleteTurn`, `scheduleDeleteTurn`, `purgeActorData`, `schedulePurgeActorData`, `cancelDeletion`, `forceRunDeletion`, `getDeletionStatus`.
- React composer optimistic config: `useCodex({ composer: { optimistic: { enabled: true }, onSend } })` (assistant placeholder is enabled by default when optimism is enabled).
- React sync hydration overlay (optional):
  - pass `syncHydrationSource` to `CodexProvider`.
  - `useCodex(...).messages` includes `syncProgress` (`syncedCount`, `totalCount`, `syncState`, `label`).
  - local unsynced messages are merged immediately and reduce `syncProgress.syncedCount` until durable sync catches up.
  - `unsyncedMessageIds` matching accepts both scoped ids (`turnId:messageId`) and plain `messageId` values.
  - `syncProgress.syncState: "syncing"` is active in-flight sync; canonical send policy is to block user sends until terminal state.
  - bridge snapshots may include `syncJobId`, `syncJobState`, `syncJobPolicyVersion`, and `lastCursor`; consumers should gate updates by `syncJobId` to avoid stale overwrite.
  - `bridge/sync_hydration_state` updates are state-only and preserve the latest cached snapshot messages for that conversation.
- For deletion controls, prefer codex optimistic helpers against `getDeletionStatus`:
  - `useCodexOptimisticMutation(api.chat.cancelDeletion, codexOptimisticPresets.deletionStatus.cancel(api.chat.getDeletionStatus))`
  - `useCodexOptimisticMutation(api.chat.forceRunDeletion, codexOptimisticPresets.deletionStatus.forceRun(api.chat.getDeletionStatus))`
- Conversation-scoped archive endpoints: `archiveConversation`, `unarchiveConversation`, `listThreadsForConversation`.
- Runtime-owned sync mapping endpoints: `syncOpenConversationBinding`, `markConversationSyncProgress`, `forceRebindConversationSync`.
- Runtime-owned durable sync job mutation endpoints: `startConversationSyncSource`, `appendConversationSyncSourceChunk`, `sealConversationSyncSource`, `cancelConversationSyncJob`.
- Runtime-owned durable sync job query endpoints: `getConversationSyncJob`, `listConversationSyncJobs`.
- Startup wiring preflight query: `validateHostWiring({ actor, conversationId? })`.

Sync job source manifests:
- `expectedMessageCount` is the count of renderable messages in the imported snapshot.
- `expectedManifestJson` is a strict JSON string containing an array of `{ turnId, messageId }` entries (invalid shapes fail-closed).
- `expectedChecksum` is the immutable sealed-source checksum in the form `<chunkCount>:<totalMessageCount>:<totalByteSize>`.

- Sync terminal semantics are fail-closed: terminal success requires checksum match plus exact expected manifest set match; mismatches terminal-fail with stable sync error codes.
- Component thread mapping query is available for runtime-id lookups: `components.codexLocal.threads.listRuntimeThreadBindings`.
- Component thread list rows (`components.codexLocal.threads.list`) now include `preview` as a required string for display-friendly labels (`conversationId`, `preview`, `status`, `updatedAt`).
- Runtime thread/conversation control helpers include: `importLocalThreadToPersistence`, `resumeThread`, `forkThread`, `setThreadName`, `compactThread`, `rollbackThread`, `readThread`, `listThreads`, `listLoadedThreads`, `archiveConversation`, `unarchiveConversation`.
- `listThreads` uses a canonical typed return shape: `{ data: Array<{ threadId, preview, updatedAt, messageCount }>, nextCursor }`; runtime attempts bounded `thread/read(includeTurns=true)` enrichment and preserves base list counts if enrichment fails.
- Runtime conversation control helpers include: `newConversation`, `resumeConversation`, `listConversations`, `forkConversation`, `archiveConversation`, `interruptConversation`, `getConversationSummary`.
- Tauri lifecycle helper includes `refreshLocalThreads()` to emit a fresh local-thread snapshot without reopening the runtime.
- `@zakstam/codex-local-component/test` exports `register` and `schema` for component-oriented test setup.
- For full implementation sequence, use `docs/CANONICAL_INTEGRATION.md`.
- For fail-fast setup diagnostics, run `pnpm --filter @zakstam/codex-local-component run doctor:integration`.
- Runtime process-exit handling is fail-closed: pending requests are rejected and lifecycle transitions to `phase: "error"` with `source: "process_exit"`.
