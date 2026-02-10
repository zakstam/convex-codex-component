# Persistent CLI App (End-to-End Consumer Flow)

This example is a real consumer-style integration:

- Codex runs locally via `codex app-server` over stdio.
- A real Convex app mounts the `codexLocal` component.
- Thread/turn/event data is persisted to Convex through host app mutations.

## Run it

1. Install dependencies:

```bash
pnpm install
```

2. Start Convex codegen + backend in terminal A:

```bash
cd apps/examples/persistent-cli-app
pnpm run dev:convex
```

3. In terminal B (same folder), start the CLI:

```bash
cd apps/examples/persistent-cli-app
pnpm start
```

The CLI resolves Convex URL in this order:

- `CONVEX_URL` env var
- `NEXT_PUBLIC_CONVEX_URL` env var
- `.env.local` / `convex/.env.local` (`CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`)
- fallback from `CONVEX_DEPLOYMENT` to `https://<deployment>.convex.cloud`

Important: use `pnpm run dev:convex` (not raw `npx convex dev`) in this local monorepo setup.
The script prepares local component dependencies first and mounts the package using `@zakstam/codex-local-component/convex.config`.

## TUI behavior

- Full-screen terminal UI with:
  - status header (`run-id`, thread, turn status)
  - scrollback message pane
  - dedicated input bar (`you> ...`)
- You can keep typing while assistant output streams; input stays isolated in the input bar.

## Chat commands

- Type any message and press Enter.
- `/interrupt` interrupts an in-flight turn.
- `/state` prints persisted thread/stream stats from Convex.
- `/exit` exits.

## Optional environment variables

- `CODEX_BIN`: path to `codex` binary
- `CODEX_MODEL`: model for `thread/start`
- `CODEX_CWD`: working directory passed to Codex
- `ACTOR_TENANT_ID`: demo tenant id used in Convex writes
- `ACTOR_USER_ID`: demo user id used in Convex writes
- `ACTOR_DEVICE_ID`: demo device id used in Convex writes
- `SAVE_STREAM_DELTAS`: `true`/`false` to persist assistant token deltas (`false` default)
- `DELTA_THROTTLE_MS`: active-stream flush cadence in milliseconds (`250` default)

## What this proves

- local Codex runtime streaming
- strict protocol parsing
- Convex persistence of stream events via `codex.sync.ingestSafe`
- durable message history persistence via `codex.messages.listByThread`
- persisted thread/turn state fetch via host app queries

## Consumer helper APIs

For app-level integrations, prefer package helpers over raw component refs:

- `@zakstam/codex-local-component/client` for server/client helper wrappers
- `@zakstam/codex-local-component/react` for `useCodexMessages`, `useCodexThreadState`, and optimistic send utilities

## Hook-ready endpoints in this example

`convex/chat.ts` now includes host functions designed for React hooks:
the file is wired through shared helpers from `@zakstam/codex-local-component/host`
so host wrapper behavior stays aligned with other examples/smoke apps.

- `chat.listThreadMessagesForHooks` for `useCodexMessages` / `useCodexStreamingMessages`
- `chat.listTurnMessagesForHooks` for `useCodexTurn`
- `chat.listPendingApprovalsForHooks` + `chat.respondApprovalForHooks` for `useCodexApprovals`
- `chat.interruptTurnForHooks` for `useCodexInterruptTurn`
- `chat.registerTurnStart` for `useCodexComposer`

Example usage:

```tsx
import { useCodexApprovals, useCodexComposer, useCodexMessages } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";

const actor = { tenantId: "demo", userId: "demo", deviceId: "web-1" };

const messages = useCodexMessages(
  api.chat.listThreadMessagesForHooks,
  { actor, threadId },
  { initialNumItems: 30, stream: true },
);

const approvals = useCodexApprovals(
  api.chat.listPendingApprovalsForHooks,
  { actor, threadId },
  api.chat.respondApprovalForHooks,
  { initialNumItems: 20 },
);

const composer = useCodexComposer(api.chat.registerTurnStart);
```
