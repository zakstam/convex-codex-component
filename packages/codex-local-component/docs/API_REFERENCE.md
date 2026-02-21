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
| `resolveActorFromAuth` | `function` | Canonical actor helper that binds `actor.userId` to `ctx.auth.getUserIdentity().subject`. |
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
- Canonical bridge lifecycle contract is push + snapshot:
  - runtime: `subscribeLifecycle(listener)` + `getLifecycleState()`
  - Tauri client: `bridge.lifecycle.subscribe(listener)` + `bridge.lifecycle.getState()`
  - lifecycle fields include `running`, `phase`, `source`, `updatedAtMs`, `conversationId`, `runtimeConversationId`, and `turnId`.
- Runtime start contract is split:
  - `connect(...)`: transport/session only
  - `openThread({ strategy, conversationId? })`: explicit conversation start/resume/fork
  - `importLocalThreadToPersistence({ runtimeThreadHandle, conversationId? })`: canonical single-call local-thread import into persistence
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
- For deletion controls, prefer codex optimistic helpers against `getDeletionStatus`:
  - `useCodexOptimisticMutation(api.chat.cancelDeletion, codexOptimisticPresets.deletionStatus.cancel(api.chat.getDeletionStatus))`
  - `useCodexOptimisticMutation(api.chat.forceRunDeletion, codexOptimisticPresets.deletionStatus.forceRun(api.chat.getDeletionStatus))`
- Conversation-scoped archive endpoints: `archiveConversation`, `unarchiveConversation`, `listThreadsForConversation`.
- Runtime-owned sync mapping endpoints: `syncOpenConversationBinding`, `markConversationSyncProgress`, `forceRebindConversationSync`.
- Component thread mapping query is available for runtime-id lookups: `components.codexLocal.threads.listRuntimeThreadBindings`.
- Component thread list rows (`components.codexLocal.threads.list`) now include `preview` as a required string for display-friendly labels (`conversationId`, `preview`, `status`, `updatedAt`).
- Runtime thread/conversation control helpers include: `importLocalThreadToPersistence`, `resumeThread`, `forkThread`, `setThreadName`, `compactThread`, `rollbackThread`, `readThread`, `listThreads`, `listLoadedThreads`, `archiveConversation`, `unarchiveConversation`.
- Runtime conversation control helpers include: `newConversation`, `resumeConversation`, `listConversations`, `forkConversation`, `archiveConversation`, `interruptConversation`, `getConversationSummary`.
- Tauri lifecycle helper includes `refreshLocalThreads()` to emit a fresh local-thread snapshot without reopening the runtime.
- `@zakstam/codex-local-component/test` exports `register` and `schema` for component-oriented test setup.
- For full implementation sequence, use `docs/CANONICAL_INTEGRATION.md`.
- For fail-fast setup diagnostics, run `pnpm --filter @zakstam/codex-local-component run doctor:integration`.
