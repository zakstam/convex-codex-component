---
"@zakstam/codex-local-component": minor
---

Simplify `createCodexHost(...)` actor policy configuration to a direct actor shape.

New shape:
- `actorPolicy: { userId: string }`

Removed shape:
- `actorPolicy: { mode: "serverActor", serverActor: { userId: string } }`

This reduces boilerplate for all consumers and removes the single-mode `mode` discriminant from the public host API.
