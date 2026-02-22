# Codex Debug Harness

Node REPL harness that drives the same helper command/event protocol used by the Tauri bridge.

## Start

```bash
pnpm --filter codex-local-debug-harness run start
```

## Scenario Repro

```bash
pnpm --filter codex-local-debug-harness run repro:no-response
```

## Replay Exported Repro Artifact

```bash
pnpm --filter codex-local-debug-harness run start
# then in REPL:
replay-artifact /path/to/tauri-repro-*.json
```

## Agent Debugging Command

Run from repository root when agents need to reproduce Tauri/runtime failures:

```bash
pnpm -C codex-convex-component run example:debug:repro:no-response
```

This runs a deterministic `start -> open-thread -> send -> status` scenario and writes a trace artifact under `./.tmp/traces/`.

## Notes

- This harness spawns `apps/examples/tauri-app/dist-node/bridge-helper.js`.
- It auto-loads defaults from `apps/examples/tauri-app/.env.local` when present, with process env taking precedence.
- It logs a timeline and classifies stalls like missing acks or missing `turn/*` events after `send_turn`.
- Use `save-trace` in REPL to write a JSONL artifact under `./.tmp/traces/`.
- Workspace `typecheck` defaults to TS7 preview (`tsgo`); use `typecheck:tsc` for legacy `tsc --noEmit`.
