# Persistent CLI App

This app demonstrates the canonical runtime-owned consumer flow against a real Convex backend.
It is an example implementation of the package strategy defined in:

- `packages/codex-local-component/LLMS.md`

LLM onboarding entrypoint: `packages/codex-local-component/LLMS.md`.

Canonical default used here: runtime-owned host integration.
This README is operational guidance for this example app only; package docs define the integration contract.

## Runbook and Setup

- Shared run/check commands and required variables live in [packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md](../../packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md) (section: `Persistent CLI Example`).

## Host Surface Ownership

- `convex/chat.ts`: generated host shim using `defineCodexHostDefinitions(...)`
- `convex/chat.extensions.ts`: optional app-specific additions

Thread contract note:

- runtime-owned `ensureThread` is single-path (no mode branching)
- provide `threadId` when resolving thread context

Host shim workflow:

- `pnpm run sync:host-shim`
- `pnpm run check:host-shim`

Create and export environment before starting the app as documented in the shared runbook.
