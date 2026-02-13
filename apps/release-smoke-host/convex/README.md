# Release Smoke Host Convex Functions

This directory defines helper-wired host wrappers used by the release smoke app.

Canonical consumer implementation path lives in:

- `packages/codex-local-component/LLMS.md`

## File Ownership

- `convex.config.ts`: mounts `codexLocal`
- `chat.ts`: helper-defined runtime-owned wrapper surface

## Development

From `apps/release-smoke-host`:

```bash
pnpm run dev:convex
pnpm run dev:convex:once
pnpm run typecheck:convex
```
