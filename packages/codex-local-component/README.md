# Codex Local Convex Component

[![npm version](https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component)](https://www.npmjs.com/package/@zakstam/codex-local-component)

Convex component for Codex integrations where Codex runs locally while thread state, messages, approvals, and replay are persisted in Convex.

> [!IMPORTANT]
> `@zakstam/codex-local-component` is in **alpha** and ready for active testing.
> It is still experimental and **not** ready for production use.

Canonical default: runtime-owned host integration.

## Install

```bash
pnpm add @zakstam/codex-local-component convex
```

React hooks require `react` peer dependency (`^18` or `^19`).

## Canonical Implementation

Use one source of truth for implementation steps:

- `./LLMS.md` (LLM-only execution manifest)
- This README (human onboarding and package integration checklist)

`LLMS.md` is intentionally LLM-targeted; humans should start with this file.

## Quickstart Summary

1. Mount component in `convex/convex.config.ts` with `app.use(codexLocal)`.
2. Define host endpoints directly in `convex/chat.ts` with `createCodexHost(...)`.
3. Optionally keep app-specific additions in `convex/chat.extensions.ts` and re-export from `convex/chat.ts`.
4. Start runtime in runtime-owned mode.
5. Call `chat.validateHostWiring` at startup.
6. Use `@zakstam/codex-local-component/react` hooks against canonical host endpoints.

## Package Import Paths

- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/host`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/convex.config`

## Docs Map

- Human onboarding entrypoint: `./README.md` (this file)
- Agent execution manifest: `./LLMS.md`
- Canonical implementation guide: `docs/CANONICAL_INTEGRATION.md`
- API reference: `docs/API_REFERENCE.md`
- Example app runbook (setup/checks/env): `docs/EXAMPLE_APPS_RUNBOOK.md`
- Fallback governance policy: `docs/FALLBACK_POLICY.md`

## One-shot LLM handoff prompt for external users

Give this prompt to an LLM after installing the package to get setup and code changes started:

```text
Integrate `@zakstam/codex-local-component` in this project using only this package's docs.

Use this file (`README.md`) first, then follow only the mapped docs for the task:

- Canonical integration: `docs/CANONICAL_INTEGRATION.md`
- API lookup: `docs/API_REFERENCE.md`
- Optional runbook/checks: `docs/EXAMPLE_APPS_RUNBOOK.md`

Keep changes minimal and stay in runtime-owned mode.
Validate with:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run typecheck`

If a prerequisite is missing for an app, ask for package-specific assumptions before continuing.
```

## Human integration checklist

1. Install package dependencies:

```bash
pnpm add @zakstam/codex-local-component convex
```

2. Mount the component in `convex/convex.config.ts`.

3. Generate Convex types before wiring:

```bash
npx convex dev --once
```

4. Define host endpoints from `createCodexHost(...)` in `convex/chat.ts`.

5. Start runtime-owned host wiring through `@zakstam/codex-local-component/host`.

6. Call `chat.validateHostWiring` during startup.

7. Run app checks:

```bash
pnpm run dev:convex:once
pnpm run lint
pnpm run typecheck
```

## Data Lifecycle APIs

The component supports async cascade deletion with job polling:

- `threads.deleteCascade`
- `threads.scheduleDeleteCascade`
- `turns.deleteCascade`
- `turns.scheduleDeleteCascade`
- `threads.purgeActorData`
- `threads.schedulePurgeActorData`
- `threads.cancelScheduledDeletion`
- `threads.forceRunScheduledDeletion`
- `threads.getDeletionJobStatus`

## Type Safety Checks

- `pnpm --filter @zakstam/codex-local-component run lint`
- `pnpm --filter @zakstam/codex-local-component run typecheck`
- `pnpm --filter @zakstam/codex-local-component run check:unsafe-types`
- `pnpm --filter @zakstam/codex-local-component run check:fallback-policy`
