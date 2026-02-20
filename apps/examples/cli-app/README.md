# CLI Example App

This app is a lightweight local-runtime demo.
It is an example, not the canonical integration guide.

Canonical consumer implementation path:

- `packages/codex-local-component/LLMS.md`

This app is intentionally lightweight and does not define an integration alternative to the package canonical path.

LLM onboarding entrypoint: `packages/codex-local-component/LLMS.md`.

## Run

```bash
pnpm install
cd apps/examples/cli-app
pnpm start
```

## Commands in Chat

- send any message
- `/interrupt` to stop in-flight turn
- `/exit` to quit

## Optional Env

- `CODEX_BIN`
- `CODEX_MODEL`
- `CODEX_CWD`
