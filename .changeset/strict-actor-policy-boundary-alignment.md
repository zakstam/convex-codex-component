"@zakstam/codex-local-component": minor
---

Harden external integration contracts by removing `createCodexHost` actor-policy shorthand and requiring explicit `{ mode: "serverActor", serverActor: { userId } }`.

Align examples with generated-type boundary discipline by switching persistent CLI host calls to generated `api.chat.*` references and removing app-side reads of component-owned `codex_*` tables in the Tauri example host surface.

Update canonical docs to clarify explicit actor policy requirements and shorthand rejection.
