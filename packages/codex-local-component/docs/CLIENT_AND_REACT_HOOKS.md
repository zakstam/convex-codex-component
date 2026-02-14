# Client Helpers and React Hooks

Canonical default: runtime-owned host integration.
Official recommendation: prefer React hooks over app-defined state composition.

This doc defines client and hook contracts for the canonical path in `../LLMS.md`.

## Actor Scope Contract

All hook/query/mutation args use `actor: { userId?: string }`.

- `userId` present -> reads/writes isolated to that user.
- `userId` omitted -> reads/writes isolated to anonymous scope only.

## SDK Surfaces

- `@zakstam/codex-local-component` (types and host utilities)
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/react-integration`

Host Convex wrappers should be defined in `convex/chat.ts` via `defineRuntimeOwnedHostEndpoints(...)`, with optional app-owned additions in `convex/chat.extensions.ts`.

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
- `useCodexChat`
- `useCodexDynamicTools`
- `useCodexRuntimeBridge`
- `useCodexAccountAuth`
- `useCodexThreads`
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
- `useCodexDynamicTools` -> `chat.listPendingServerRequestsForHooks` + host runtime `respondDynamicToolCall(...)`
- `useCodexThreads` -> app thread-list query + thread lifecycle mutations
- `useCodexTokenUsage` -> `chat.listTokenUsageForHooks`
- `useCodexChat` -> composition of `useCodexMessages` + `useCodexThreadActivity` + conversation controller with explicit tool policy controls

## Reference React Integration Adapter

Use `@zakstam/codex-local-component/react-integration` to centralize endpoint mapping and actor/thread arg shaping.

```tsx
import { createCodexReactConvexAdapter } from "@zakstam/codex-local-component/react-integration";
import { useCodexChat } from "@zakstam/codex-local-component/react";
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
const conversation = useCodexChat({
  messages: {
    query: api.chat.listThreadMessagesForHooks,
    args: threadId ? { actor, threadId } : "skip",
    initialNumItems: 30,
    stream: true,
  },
  threadState: {
    query: api.chat.threadSnapshotSafe,
    args: threadId ? { actor, threadId } : "skip",
  },
  approvals: {
    onResolve: async (approval, decision) =>
      respondApproval({ actor, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId, decision }),
  },
  composer: { onSend: async (text) => sendUserTurn(text) },
  interrupt: { onInterrupt: async () => interruptTurn() },
});
```

`useCodexChat` is the recommendation when you want a single high-level hook and explicit tool policy controls:

```tsx
const { tools } = conversation;

tools.disableTools(["item/tool/call"]);
tools.overrideToolHandler("item/tool/call", async (call) => {
  return {
    success: false,
    contentItems: [{ type: "text", text: "Tool disabled by policy." }],
  };
});
```

## Blessed Example App

The blessed production wiring reference is:

- `apps/examples/tauri-app`

It demonstrates helper-defined host wrappers plus React-first hook composition (`useCodexChat` with tool policy controls) and thread snapshot hooks.

## Strict State Authority Table

| UI Signal | Source of truth | Ignore for this signal | Why |
| --- | --- | --- | --- |
| Thread activity badge (`idle/streaming/awaiting_approval/failed/interrupted`) | `useCodexThreadActivity(chat.threadSnapshotSafe, ...)` | Raw `messages`, `turns`, `streamStats`, `activeStreams` stitching in app code | Uses canonical precedence: `pending approvals > streaming message > active stream > in-flight newer than terminal > terminal > idle`, including stream-drain lifecycle markers to prevent stuck streaming. |
| Show "needs approval" UI | `activity.phase === "awaiting_approval"` (or `pendingApprovals` count if not using activity hook) | Turn status alone | Turn lifecycle does not encode approval waits. |
| Render assistant text deltas | `useCodexMessages(..., { stream: true })` | `turns` alone | Turn state tracks orchestration, not message text continuity. |
| Enable cancel/interruption affordance | `activity.phase === "streaming"` with `activity.activeTurnId` | `threadStatus` alone | Active turn identity should come from normalized activity. |
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

