# Release Smoke Host App

This app validates package release behavior in a real consumer setup.
It is a verification harness, not a canonical onboarding guide.

Canonical consumer implementation path:

- `packages/codex-local-component/LLMS.md`

LLM onboarding entrypoint: `packages/codex-local-component/LLMS.md`.

## What It Validates

1. Package tarball install (`pnpm pack` -> install `.tgz`).
2. Convex mount through `@zakstam/codex-local-component/convex.config`.
3. Generated host wrappers and runtime flow in an end-to-end host app.
4. Installed package freshness guardrails for canonical turn-id extraction (prevents stale legacy fallback copies).

## Run

```bash
pnpm install
cd apps/release-smoke-host
pnpm run dev:convex
pnpm start
```

## Checks

```bash
pnpm run typecheck
pnpm run typecheck:convex
pnpm run wiring:smoke
pnpm run smoke:checks
```
