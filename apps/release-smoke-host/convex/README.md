# Release Smoke Host Convex Functions

This directory defines generated host wrappers used by the release smoke app.

Canonical consumer implementation path lives in:

- `packages/codex-local-component/LLMS.md`

## File Ownership

- `convex.config.ts`: mounts `codexLocal`
- `chat.generated.ts`: generated preset wrapper surface (do not edit)
- `chat.extensions.ts`: app-specific extensions
- `chat.ts`: stable entrypoint that re-exports generated + extensions

## Development

From `apps/release-smoke-host`:

```bash
pnpm run dev:convex
pnpm run dev:convex:once
pnpm run typecheck:convex
```

From repo root:

```bash
pnpm run host:check
```
