# API Reference

This package documents one integration path only.

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
- Export Convex host functions as named constants in `convex/chat.ts` to keep generated `api.chat.*` contracts stable.
- Runtime-owned `ensureThread` is single-path and requires `threadId`.
- Thread-scoped query exports are safe-by-default and return thread-read status payloads (`threadStatus`, `code`, `message`) for handled read failures. `listPendingServerRequests` returns an empty list on missing-thread fallback to keep runtime request polling consumers on a stable array contract.
- External identifier read aliases are also available:
  - `threadSnapshotByExternalId`
  - `listThreadMessagesByExternalId`
  - `listTurnMessagesByExternalId`
  - `listPendingServerRequestsByExternalId`
  These map `externalThreadId` server-side to runtime `threadId` and preserve existing fallback contracts.
- Runtime-owned lifecycle endpoints: `deleteThread`, `scheduleDeleteThread`, `deleteTurn`, `scheduleDeleteTurn`, `purgeActorData`, `schedulePurgeActorData`, `cancelDeletion`, `forceRunDeletion`, `getDeletionStatus`.
- Runtime thread control helpers include: `resumeThread`, `forkThread`, `archiveThread`, `setThreadName`, `unarchiveThread`, `compactThread`, `rollbackThread`, `readThread`, `listThreads`, `listLoadedThreads`.
- `@zakstam/codex-local-component/test` exports `register` and `schema` for component-oriented test setup.
- For full implementation sequence, use `docs/CANONICAL_INTEGRATION.md`.
