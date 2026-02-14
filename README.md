> [!WARNING]
> `@zakstam/codex-local-component` is in **alpha** and ready for active testing.
> It is still experimental and **not** ready for production use.

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

Use one implementation path only:

- `packages/codex-local-component/LLMS.md`

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

- Canonical implementation: `packages/codex-local-component/LLMS.md`
- Package front door: `packages/codex-local-component/README.md`
- Host details: `packages/codex-local-component/docs/HOST_INTEGRATION.md`
- Hooks and client contracts: `packages/codex-local-component/docs/CLIENT_AND_REACT_HOOKS.md`
- Operations and errors: `packages/codex-local-component/docs/OPERATIONS_AND_ERRORS.md`
- Runtime-owned reference details: `packages/codex-local-component/docs/RUNTIME_OWNED_REFERENCE_HOST.md`
