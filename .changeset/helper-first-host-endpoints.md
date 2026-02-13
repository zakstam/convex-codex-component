---
"@zakstam/codex-local-component": minor
---

Adopt helper-first host wiring for consumers so host endpoints are defined directly in `convex/chat.ts` using `defineRuntimeOwnedHostEndpoints` / `defineDispatchManagedHostEndpoints`.

This removes consumer dependency on generated `chat.generated.ts` surfaces and updates examples, smoke host wiring, docs, and scripts to use the direct helper workflow.
