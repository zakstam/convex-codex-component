# CLI Test App (Real Local Runtime)

This is a real interactive CLI chat app backed by local `codex app-server` over stdio.
It creates one thread, lets you send many messages, and streams assistant responses.

## Usage

1. Install dependencies:

```bash
pnpm install
```

2. Run interactive chat:

```bash
cd apps/examples/cli-app
pnpm start
```

The start script builds `@convex-dev/codex-local-component` first so imports resolve from the local workspace package.

3. In the chat:
- Type any message and press Enter.
- Use `/interrupt` to stop an in-flight turn.
- Use `/exit` (or Ctrl+D) to quit.

## Environment variables

- `CODEX_BIN`: optional path to `codex` binary (default: `codex`)
- `CODEX_MODEL`: optional model for `thread/start`
- `CODEX_CWD`: optional cwd for `thread/start`

## What it tests

- strict JSON-RPC parsing + schema validation
- local stdio bridge lifecycle
- thread creation and multi-turn conversation loop
- streamed assistant text output
- interrupt handling and protocol error handling
