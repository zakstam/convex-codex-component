# Release Smoke Host Convex Functions

This folder defines host wrappers used by the release smoke app to validate
`@zakstam/codex-local-component` in a real consumer setup.

## Files

- `convex.config.ts`: mounts `codexLocal` via
  `@zakstam/codex-local-component/convex.config`.
- `chat.ts`: host queries/mutations used by the smoke runner (`src/index.ts`) to:
  - create threads and turns
  - ingest stream deltas (`sync.pushEvents`)
  - query thread state and persistence stats

## Development

From `apps/release-smoke-host`:

```bash
pnpm run dev:convex
```

For one-shot codegen and checks:

```bash
pnpm run dev:convex:once
pnpm run typecheck:convex
```

## Notes

- Use generated Convex types from `./_generated/*`.
- This app is a smoke consumer, not a generic Convex template.
