# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Local-first Convex component for Codex integrations where Codex runs on the user's machine (desktop/CLI).

## What this package contains

- Convex component scaffold (`src/component`) with:
  - thread and turn lifecycle APIs
  - sync ingest/replay APIs
  - reasoning segment query APIs
  - approvals APIs
  - server-request tracking APIs (`item/*/requestApproval`, `item/tool/requestUserInput`, `item/tool/call`)
- Local adapter skeleton (`src/local-adapter`) to manage `codex app-server` over stdio
- Typed protocol boundary (`src/protocol`) with `unknown` only at wire ingress

## Sync API surface

`components.codexLocal.sync` now exposes:

- `heartbeat`
- `ingest`
- `ensureSession`
- `ingestSafe`
- `replay`
- `resumeReplay`
- `listCheckpoints`
- `upsertCheckpoint`

Ingest takes split payloads:

- `streamDeltas`
- `lifecycleEvents`

Replay returns explicit recovery metadata:

- `streams` (active stream list)
- `streamWindows` (`ok | rebased | stale`)
- `nextCheckpoints`

Recommended host entrypoints:

- `ensureSession` before ingest on startup/reconnect
- `ingestSafe` for runtime event ingest (session recovery + typed error surface)
- `replay`/`resumeReplay` + persisted checkpoints for reconnect recovery

## Consumer SDK exports

- `@zakstam/codex-local-component/client`
  - message/approval/turn/thread helpers
  - reasoning helper: `listReasoningByThread`
  - sync helpers: `replayStreams`, `resumeStreamReplay`
- `@zakstam/codex-local-component/react`
  - hooks for messages/reasoning, approvals, turn state, composer, interrupts
- `@zakstam/codex-local-component/app-server`
  - typed request builders for app-server initialize, thread lifecycle, and turn flows
  - typed server-request response builders for command/file approval, tool user-input, and dynamic tool calls
- `@zakstam/codex-local-component/host`
  - host-side Convex wrapper helpers
  - reusable host `convex/chat.ts` slice primitives (validators + handlers)
  - runtime loop orchestration helper (`createCodexHostRuntime`) with:
    - startup strategy: `threadStrategy: "start" | "resume" | "fork"`
    - dynamic tool registration on startup/resume via `dynamicTools`
    - runtime thread lifecycle controls (`resumeThread`, `forkThread`, `archiveThread`, `unarchiveThread`, `rollbackThread`, `readThread`, `listThreads`, `listLoadedThreads`)
    - pending server-request controls (`listPendingServerRequests`, `respondCommandApproval`, `respondFileChangeApproval`, `respondToolUserInput`, `respondDynamicToolCall`)
    - runtime ingest diagnostics via `getState().ingestMetrics` (enqueued/skipped counts by event kind)
  - for Convex server files, import the Node-safe subpath:
    - `@zakstam/codex-local-component/host/convex`

Reasoning stream defaults:

- reasoning summary deltas are persisted/replayed by default
- raw reasoning deltas require explicit runtime opt-in (`exposeRawReasoningDeltas: true`)

## Convex install pattern

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

## Docs

- `docs/HOST_INTEGRATION.md`
- `docs/OPERATIONS_AND_ERRORS.md`
- `docs/CLIENT_AND_REACT_HOOKS.md`
