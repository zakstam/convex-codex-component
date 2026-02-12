# Tauri Example (Desktop + Convex Persistence)

This app is the blessed reference integration for production-grade React + Convex host wiring.
React hooks are the official recommendation for consumer integrations.

Canonical wiring in this app centers on:
- `useCodexConversationController`
- `useCodexThreadState`
- `useCodexTauriEvents` (single owner for Tauri runtime event subscriptions)
- generated host wrappers in `convex/chat.generated.ts`
- runtime-owned host mode (`dispatchManaged: false`) with `runtime.sendTurn(...)`

Canonical consumer implementation path:

- `packages/codex-local-component/LLMS.md`

## State Authority

- Runtime start/stop UI signals must be sourced from `codex:bridge_state`.
- `useCodexTauriEvents` is the only place that subscribes to Tauri bridge events.
- The hook is StrictMode-safe and deduplicates transition toasts to one toast per real running-state edge.

## Run

```bash
pnpm install
cd apps/examples/tauri-app
pnpm run dev
```

## Required Env

Create `apps/examples/tauri-app/.env.local`:

```bash
VITE_CONVEX_URL=...
```

Optional:

- `VITE_CODEX_BIN`
- `VITE_CODEX_MODEL`
- `VITE_CODEX_CWD`
- `CODEX_HELPER_BIN`
- `CODEX_NODE_BIN`
- `CODEX_BRIDGE_RAW_LOG` (`all` for every app-server line, `turns` for turn-focused lines)

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

## ChatGPT Token Contract

When using ChatGPT auth token login/refresh flows, the payload now follows the latest app-server schema:

- `accessToken` (required)
- `chatgptAccountId` (required)
- `chatgptPlanType` (optional, nullable)

## Host Surface Ownership

- `convex/chat.generated.ts`: generated preset wrappers
- `convex/chat.extensions.ts`: app-owned endpoints (for example `listThreadsForPicker`)
- `convex/chat.ts`: stable re-export entrypoint

Regenerate wrappers from repo root:

```bash
pnpm run host:generate
```

## Useful Checks

```bash
pnpm run typecheck:convex
pnpm run check:wiring:convex
pnpm run tauri:check
```
