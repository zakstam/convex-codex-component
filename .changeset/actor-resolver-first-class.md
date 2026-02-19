---
"@zakstam/codex-local-component": minor
---

Add first-class `actorResolver` support to `createCodexHost` so consumers can resolve/bind actor identity once for all runtime-owned host mutations and queries.

This removes the need for per-endpoint `withBoundMutationActor` / `withBoundQueryActor` boilerplate in consumer host surfaces and supports typed `mutation(codex.defs.mutations.*)` / `query(codex.defs.queries.*)` exports for generated `api.chat.*` contracts.
