---
"@zakstam/codex-local-component": patch
---

Simplify actor-locked host wiring by adding guarded runtime-owned endpoint helpers.

- Add `defineGuardedRuntimeOwnedHostEndpoints(...)` to `@zakstam/codex-local-component/host/convex` so consumers can apply mutation/query actor guards once.
- Add `guardRuntimeOwnedHostDefinitions(...)` for applying guard policy to existing runtime-owned definitions.
- Update host integration and API reference docs with the guarded wiring path.
- Migrate the Tauri example to use the guarded helper and reduce repeated actor-resolution boilerplate in custom endpoints.
