# Release Smoke Host App

This app validates `@zakstam/codex-local-component` as a real consumer.

It does three important things:

1. Packs the component (`pnpm pack`) from `../../packages/codex-local-component`.
2. Installs the generated `.tgz` into this host app.
3. Runs a real Convex + local Codex bridge flow through host wrappers.

## Run

1. Install workspace dependencies at repo root:

```bash
pnpm install
```

2. Start Convex in terminal A:

```bash
cd apps/release-smoke-host
pnpm run dev:convex
```

3. Run smoke CLI in terminal B:

```bash
cd apps/release-smoke-host
pnpm start
```

## What this validates

- Consumer-style package install from tarball (not `src/...` deep import).
- Host app mounting via:
  - `import codexLocal from "@zakstam/codex-local-component/convex.config"`
- Shared host wrapper slice usage via `@zakstam/codex-local-component/host`
  (keeps smoke host endpoints aligned with example apps).
- End-to-end thread/turn/event persistence through host wrappers.
- Interrupt path and reconnect replay behavior in a real host context.

## Helpful commands

- One-shot codegen check:

```bash
pnpm run dev:convex:once
```

- Typecheck host:

```bash
pnpm run typecheck
```
