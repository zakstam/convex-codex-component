> [!WARNING]
> `@zakstam/codex-local-component` is in **beta** and ready for integration — expect breaking changes before 1.0.

<p align="center">
  <strong>@zakstam/codex-local-component</strong>
</p>

<p align="center">
  Convex component for Codex local-runtime integrations.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@zakstam/codex-local-component">
    <img src="https://img.shields.io/npm/v/%40zakstam%2Fcodex-local-component" alt="npm version" />
  </a>
</p>

---

## Canonical Consumer Strategy

For this monorepo, use one implementation path:

- `packages/codex-local-component/README.md` (for package consumers)
- `packages/codex-local-component/LLMS.md` (for LLM execution-only path)

Canonical default: runtime-owned host integration.

## Monorepo Layout

- `packages/codex-local-component`: publishable package
- `apps/examples/cli-app`: local CLI bridge demo
- `apps/examples/persistent-cli-app`: persistent Convex host example
- `apps/examples/tauri-app`: desktop example
- `apps/release-smoke-host`: tarball consumer smoke host

## Install

```bash
pnpm install
```

## Common Commands

```bash
pnpm run component:build
pnpm run component:ci
pnpm run lint
```

## External consumer onboarding

- npm consumers should start at `packages/codex-local-component/README.md`
  and use the included one-shot LLM handoff prompt for automated integration.

## LLM handoff prompt (paste this into an LLM)

```text
Integrate `@zakstam/codex-local-component` in this project using only the package docs.

Use `packages/codex-local-component/README.md` first, then follow only the mapped docs for the task:

- Host wiring: `packages/codex-local-component/docs/HOST_INTEGRATION.md`
- React integration: `packages/codex-local-component/docs/CLIENT_AND_REACT_HOOKS.md` (if using React)
- API lookup: `packages/codex-local-component/docs/API_REFERENCE.md`
- Runtime/protocol troubleshooting: `packages/codex-local-component/docs/OPERATIONS_AND_ERRORS.md`
- Optional runbook/checks: `packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md`

Keep changes minimal and stay in runtime-owned mode.
Validate with:

- `npx convex dev --once`
- `pnpm run dev:convex:once` (or app equivalent)
- `pnpm run wiring:smoke` (if available)
- `pnpm run typecheck`

If a prerequisite is missing for an app, ask for package-specific assumptions before continuing.
```

## Examples

- Persistent CLI app:

```bash
cd apps/examples/persistent-cli-app
pnpm run dev:convex
pnpm start
```

- Tauri app:

```bash
cd apps/examples/tauri-app
pnpm run dev
```

- Release smoke host:

```bash
cd apps/release-smoke-host
pnpm run dev:convex
pnpm start
```

## Docs

- Canonical package onboarding implementation: `packages/codex-local-component/README.md`
- Package front door: `packages/codex-local-component/README.md`
- Host details: `packages/codex-local-component/docs/HOST_INTEGRATION.md`
- Hooks and client contracts: `packages/codex-local-component/docs/CLIENT_AND_REACT_HOOKS.md`
- Operations and errors: `packages/codex-local-component/docs/OPERATIONS_AND_ERRORS.md`
- Runtime-owned reference details: `packages/codex-local-component/docs/RUNTIME_OWNED_REFERENCE_HOST.md`
