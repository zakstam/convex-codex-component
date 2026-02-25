---
"@zakstam/codex-runtime": minor
---

Rename package/workspace wiring from `codex-local-*` to `codex-runtime-*` and align example app integration scripts.

- Core package is renamed to `@zakstam/codex-runtime`.
- Convex adapter package is renamed to `@zakstam/codex-runtime-convex`.
- Example app package names and root workspace filters now use `codex-runtime-*`.
- Monorepo runtime orchestration scripts are renamed from `component:*` to `runtime:*`.
