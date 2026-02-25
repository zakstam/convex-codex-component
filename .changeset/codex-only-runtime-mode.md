---
"@zakstam/codex-runtime": minor
---

Introduce explicit runtime modes for `createCodexHostRuntime(...)`:

- `mode: "codex-only"` runs Codex as the authoritative runtime with no Convex persistence dependency.
- `mode: "codex+replica"` enables optional persistence replication (manual adapter or Convex-integrated setup).

This is a forward-only clean break to constructor args and adds fail-closed behavior for persistence-only APIs when persistence is disabled (`E_PERSISTENCE_DISABLED`).
