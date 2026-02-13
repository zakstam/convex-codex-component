# Client Helpers and React Hooks

Canonical default: runtime-owned host integration (`dispatchManaged: false`).
Official recommendation: prefer React hooks over app-defined state composition.

This doc defines client and hook contracts for the canonical path in `../LLMS.md`.

## Actor Scope Contract

All hook/query/mutation args use `actor: { userId?: string }`.

- `userId` present -> reads/writes isolated to that user.
- `userId` omitted -> reads/writes isolated to anonymous scope only.

## SDK Surfaces

- `@zakstam/codex-local-component/client`
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/react-integration`

Host Convex wrappers should be defined in `convex/chat.ts` via `defineRuntimeOwnedHostEndpoints(...)`, with optional app-owned additions in `convex/chat.extensions.ts`.

## Client Helpers

Common helpers used by consumers:

- `listMessages`
- `listReasoningByThread`
- `listTurnMessages`
- `listPendingApprovals`
- `respondToApproval`
- `startTurn`
- `interruptTurn`
- `enqueueTurnDispatch`
- `replayStreams`
- `resumeStreamReplay`
- `createThread`
- `deleteThreadCascade`
- `scheduleThreadDeleteCascade`
- `purgeActorCodexData`
- `schedulePurgeActorCodexData`
- `cancelScheduledDeletion`
- `forceRunScheduledDeletion`
- `getDeletionJobStatus`
- `resolveThread`
- `resumeThread`
- `getThreadState`
- `listThreads`
- `deleteTurnCascade`
- `scheduleTurnDeleteCascade`

## React Hooks

- `useCodexMessages`
- `useCodexReasoning`
- `useCodexStreamingMessages`
- `useCodexStreamingReasoning`
- `useCodexTurn`
- `useCodexThreadState`
- `useCodexThreadActivity`
- `useCodexIngestHealth`
- `useCodexBranchActivity`
- `useCodexConversationController`
- `useCodexDynamicTools`
- `useCodexRuntimeBridge`
- `useCodexAccountAuth`
- `useCodexThreads`
- `useCodexApprovals`
- `useCodexInterruptTurn`
- `useCodexAutoResume`
- `useCodexComposer`
- `useCodexTokenUsage`
- `optimisticallySendCodexMessage`

## `useCodexMessages` Host Query Contract

Your host query must accept:

- `threadId`
- `paginationOpts`
- optional `streamArgs`

`streamArgs` shape:

- `{ kind: "list", startOrder?: number }`
- `{ kind: "deltas", cursors: Array<{ streamId: string; cursor: number }> }`

Return shape:

- durable paginated message rows
- optional `streams` payload
- for delta mode: `streams`, `deltas`, `streamWindows`, `nextCheckpoints`

## Canonical Hook Endpoint Mapping

- `useCodexMessages` -> `chat.listThreadMessagesForHooks`
- `useCodexTurn` -> `chat.listTurnMessagesForHooks`
- `useCodexThreadActivity` -> `chat.threadSnapshotSafe`
- `useCodexIngestHealth` -> `chat.threadSnapshotSafe`
- `useCodexBranchActivity` -> `chat.threadSnapshotSafe`
- `useCodexApprovals` -> `chat.listPendingApprovalsForHooks` + `chat.respondApprovalForHooks`
- `useCodexDynamicTools` -> `chat.listPendingServerRequestsForHooks` + host runtime `respondDynamicToolCall(...)`
- `useCodexThreads` -> app thread-list query + thread lifecycle mutations
- `useCodexInterruptTurn` -> `chat.interruptTurnForHooks`
- `useCodexComposer` -> `chat.enqueueTurnDispatch`
- `useCodexTokenUsage` -> `chat.listTokenUsageForHooks`

## Reference React Integration Adapter

Use `@zakstam/codex-local-component/react-integration` to centralize endpoint mapping and actor/thread arg shaping.

```tsx
import { createCodexReactConvexAdapter } from "@zakstam/codex-local-component/react-integration";
import { api } from "../convex/_generated/api";

const actor = { userId: "demo-user" };
const codex = createCodexReactConvexAdapter({
  actor,
  hooks: api.chat,
});

const messages = codex.useThreadMessages(threadId, { initialNumItems: 30, stream: true });
const activity = codex.useThreadActivity(threadId);
const ingestHealth = codex.useIngestHealth(threadId);
const branchActivity = codex.useBranchActivity(threadId, { turnId: activeTurnId });
const conversation = codex.useConversationController(threadId, {
  initialNumItems: 30,
  stream: true,
  approvals: {
    onResolve: async (approval, decision) =>
      respondApproval({ actor, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId, decision }),
  },
  composer: { onSend: async (text) => sendUserTurn(text) },
  interrupt: { onInterrupt: async () => interruptTurn() },
});
```

## Blessed Example App

The blessed production wiring reference is:

- `apps/examples/tauri-app`

It demonstrates helper-defined host wrappers plus React-first hook composition (`useCodexConversationController` and thread snapshot hooks).

## Strict State Authority Table

| UI Signal | Source of truth | Ignore for this signal | Why |
| --- | --- | --- | --- |
| Thread activity badge (`idle/streaming/awaiting_approval/failed/interrupted`) | `useCodexThreadActivity(chat.threadSnapshotSafe, ...)` | Raw `messages`, `dispatches`, `turns`, `streamStats`, `activeStreams` stitching in app code | Uses canonical precedence: `pending approvals > streaming message > active stream > in-flight newer than terminal > terminal > idle`, including stream-drain lifecycle markers to prevent stuck streaming. |
| Show "needs approval" UI | `activity.phase === "awaiting_approval"` (or `pendingApprovals` count if not using activity hook) | Dispatch status alone | Dispatch lifecycle does not encode approval waits. |
| Render assistant text deltas | `useCodexMessages(..., { stream: true })` | `dispatches` and `turns` | Dispatch/turn state tracks orchestration, not message text continuity. |
| Enable cancel/interruption affordance | `activity.phase === "streaming"` with `activity.activeTurnId` | `threadStatus`, `dispatches` alone | Active turn identity should come from normalized activity. |
| Show terminal failure/interruption banner | `activity.phase === "failed"` / `"interrupted"` | Any single terminal row without recency precedence | Multiple terminal signals can coexist across turns. Use canonical merge logic. |

## Snapshot Activity Invariants (`threadSnapshotSafe`)

`threadSnapshotSafe` is the canonical authority input for activity hooks. Integrations should preserve these invariants:

- Terminal artifact reconciliation is single-path and turn-scoped.
- Terminal boundary timestamps are terminal-aware:
- message terminal boundary timestamp: `completedAt ?? updatedAt ?? createdAt`
- turn terminal boundary timestamp: `completedAt ?? startedAt`
- `createdAt` is not a completion signal by itself.
- If a message or turn is terminal, `completedAt` should be present when available.
- Streaming stats alone must not force streaming phase without active stream evidence.
- Stream drain markers (`stream/drain_complete`) must terminate stale streaming authority.
- Dispatch-managed and runtime-owned modes must produce equivalent activity phase transitions for equivalent snapshot state.

## Minimal Usage

```tsx
import { useCodexMessages } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

const messages = useCodexMessages(
  api.chat.listThreadMessagesForHooks,
  { actor, threadId },
  { initialNumItems: 30, stream: true },
);
```

## Advanced Appendix (Non-Default)

Dispatch-managed orchestration is advanced and non-default. Use only when explicitly requested:

- `DISPATCH_MANAGED_REFERENCE_HOST.md`
