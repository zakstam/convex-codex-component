# Persistent CLI App

This app demonstrates the canonical runtime-owned consumer flow against a real Convex backend.
It is an example implementation of the package strategy defined in:

- `packages/codex-local-component/LLMS.md`

LLM onboarding entrypoint: `packages/codex-local-component/LLMS.md`.

Canonical default used here: runtime-owned host integration.

## Runbook and Setup

- Shared run/check commands and required variables live in [packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md](../../packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md) (section: `Persistent CLI Example`).

## Host Surface Ownership

- `convex/chat.ts`: helper-defined preset wrappers via `defineRuntimeOwnedHostEndpoints(...)`
- `convex/chat.extensions.ts`: optional app-specific additions

Thread contract note:

- runtime-owned `ensureThread` is single-path (no mode branching)
- provide `threadId` or `externalThreadId` when resolving thread context

Create and export environment before starting the app as documented in the shared runbook.
