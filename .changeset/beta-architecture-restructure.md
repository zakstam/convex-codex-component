---
"@zakstam/codex-local-component": minor
---

Beta architecture restructure: remove dispatch-managed mode, eliminate client passthrough layer, consolidate export paths (11 to 7), split oversized files, simplify React hook surface.

Breaking changes:
- Removed `./client` export path (use default import or `./host/convex`)
- Removed `./errors` export path (use default import)
- Removed `./bridge` export path (use `./host`)
- Removed `./app-server` export path (use `./host`)
- Removed dispatch-managed mode (use runtime-owned exclusively)
- Removed `useCodexComposer`, `useCodexApprovals`, `useCodexInterruptTurn`, `useCodexAutoResume` hooks
- `useCodexConversationController` is no longer publicly exported (use `useCodexChat`)
- Removed `codex_turn_dispatches` table from schema
