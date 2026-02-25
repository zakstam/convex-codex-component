# @zakstam/codex-runtime-convex

Convex integration package for `@zakstam/codex-runtime`.

Component mount entrypoint is owned by `@zakstam/codex-runtime/convex.config`.

Canonical exports:

- `@zakstam/codex-runtime-convex/persistence`: `createConvexPersistenceAdapter(...)`
- `@zakstam/codex-runtime-convex/host`: `defineCodexHostDefinitions(...)`, host validators, shim helpers
- `@zakstam/codex-runtime-convex/tooling`: `renderCodexHostShim(...)`

For persistence wiring, pass `createConvexPersistenceAdapter(...)` to
`createCodexHostRuntime({ persistence })`.
