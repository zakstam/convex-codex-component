---
"@zakstam/codex-local-component": minor
---

Remove dispatch-managed host mode entirely. Runtime-owned is now the only host integration path.

- Deleted `src/component/dispatch.ts` and `src/client/dispatch.ts`
- Removed dispatch mutations/queries from host surface manifest
- Removed `defineDispatchManagedHostEndpoints` and `defineDispatchManagedHostSlice`
- Removed dispatch exports from `host/index.ts` and `host/convex-entry.ts`
- Removed `observability` feature flag (dead code after dispatch removal)
- Removed dispatch from generated component API types
- Updated all example apps and smoke tests
- Cleaned up documentation to reflect single-path architecture
