> [!WARNING]
> `@zakstam/codex-runtime` is in **alpha** and ready for active testing.
> It is still experimental and **not** ready for production use.

<p align="center">
  <strong>@zakstam/codex-runtime</strong>
</p>

<p align="center">
  Convex component for Codex local-runtime integrations.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@zakstam/codex-runtime">
    <img src="https://img.shields.io/npm/v/%40zakstam%2Fcodex-runtime" alt="npm version" />
  </a>
</p>

---

## Canonical Consumer Strategy

For this monorepo, use one implementation path:

- `packages/codex-runtime/README.md` (for package consumers)
- `packages/codex-runtime/LLMS.md` (for LLM execution-only path)

Canonical default: runtime-owned host integration.

## Monorepo Layout

- `packages/codex-runtime`: runtime core package
- `packages/codex-runtime-convex`: Convex host + persistence integration package
- `packages/codex-runtime-react`: React hooks/UI package
- `packages/codex-runtime-bridge-tauri`: Tauri bridge + artifact generation package
- `packages/codex-runtime-protocol-tooling`: protocol schema sync/check tooling package
- `apps/examples/cli-app`: local CLI bridge demo
- `apps/examples/persistent-cli-app`: persistent Convex host example
- `apps/examples/tauri-app`: desktop example

## Install

```bash
pnpm install
```

## Common Commands

```bash
pnpm run runtime:build
pnpm run runtime:ci
pnpm run lint
```

## Release Automation

- `.github/workflows/release.yml` publishes directly to npm when pending changesets exist and CI has already passed.
- The release workflow now runs from `workflow_run` after `codex-runtime` completes successfully on `main` (plus optional manual `workflow_dispatch`).
- `.github/workflows/codex-runtime.yml` must include `.changeset/**` and release workflow paths so release-only commits still trigger the CI gate.

## Protocol Schema Maintenance (Maintainers)

Use the package-owned workflow to sync and verify generated protocol schemas:

```bash
pnpm --filter @zakstam/codex-runtime-protocol-tooling run schema:sync -- --target ./packages/codex-runtime/src/protocol/schemas --source /path/to/codex/generated/schemas
pnpm --filter @zakstam/codex-runtime-protocol-tooling run schema:check -- --target ./packages/codex-runtime/src/protocol/schemas
pnpm --filter @zakstam/codex-runtime run schema:verify
```

## External consumer onboarding

- npm consumers should start at `packages/codex-runtime/README.md`
  and use the included one-shot LLM handoff prompt for automated integration.

## LLM handoff prompt (paste this into an LLM)

```text
Integrate `@zakstam/codex-runtime` in this project using only the package docs.

Use `packages/codex-runtime/README.md` first, then follow only the mapped docs for the task:

- Canonical integration: `packages/codex-runtime/docs/CANONICAL_INTEGRATION.md`
- API lookup: `packages/codex-runtime/docs/API_REFERENCE.md`
- Optional runbook/checks: `packages/codex-runtime/docs/EXAMPLE_APPS_RUNBOOK.md`

Keep changes minimal and stay in runtime-owned mode.
Validate with:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run check:host-shim`
- `pnpm run typecheck`

If a prerequisite is missing for an app, ask for package-specific assumptions before continuing.
```

## Examples

- Persistent CLI app:

```bash
cd apps/examples/persistent-cli-app
pnpm run dev:convex
pnpm run sync:host-shim
pnpm start
```

- Tauri app:

```bash
cd apps/examples/tauri-app
pnpm run sync:host-shim
pnpm run dev
```

## Docs

- Canonical package onboarding implementation: `packages/codex-runtime/README.md`
- Package front door: `packages/codex-runtime/README.md`
- Canonical integration: `packages/codex-runtime/docs/CANONICAL_INTEGRATION.md`
- API reference: `packages/codex-runtime/docs/API_REFERENCE.md`
- Example apps runbook: `packages/codex-runtime/docs/EXAMPLE_APPS_RUNBOOK.md`

## Repo Skills

- Package setup skill: `skills/package-setup/SKILL.md`
