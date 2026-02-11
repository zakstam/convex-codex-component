# Client Helpers and React Hooks

Canonical default: runtime-owned host integration (`dispatchManaged: false`).

This doc defines client and hook contracts for the canonical path in `../LLMS.md`.

## Actor Scope Contract

All hook/query/mutation args use `actor: { userId?: string }`.

- `userId` present -> reads/writes isolated to that user.
- `userId` omitted -> reads/writes isolated to anonymous scope only.

## SDK Surfaces

- `@zakstam/codex-local-component/client`
- `@zakstam/codex-local-component/react`

Host Convex wrappers should come from generated runtime-owned host surfaces (`convex/chat.generated.ts`) plus app-owned extensions (`convex/chat.extensions.ts`).

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
- `resolveThread`
- `resumeThread`
- `getThreadState`
- `listThreads`

## React Hooks

- `useCodexMessages`
- `useCodexReasoning`
- `useCodexStreamingMessages`
- `useCodexStreamingReasoning`
- `useCodexTurn`
- `useCodexThreadState`
- `useCodexApprovals`
- `useCodexInterruptTurn`
- `useCodexAutoResume`
- `useCodexComposer`
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
- `useCodexApprovals` -> `chat.listPendingApprovalsForHooks` + `chat.respondApprovalForHooks`
- `useCodexInterruptTurn` -> `chat.interruptTurnForHooks`
- `useCodexComposer` -> `chat.enqueueTurnDispatch`

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
