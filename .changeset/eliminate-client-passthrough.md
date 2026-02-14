---
"@zakstam/codex-local-component": minor
---

Remove the client passthrough layer (`src/client/`). All shared types (`CodexUIMessage`, `CodexQueryRunner`, `CodexMutationRunner`, etc.) are now exported from `src/shared/types.ts` via the root entrypoint. The `@zakstam/codex-local-component/client` export path has been removed.
