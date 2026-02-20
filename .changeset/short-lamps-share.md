---
"@zakstam/codex-local-component": minor
---

Add high-level thread APIs for `thread/name/set` and `thread/compact/start`.

- Add `buildThreadSetNameRequest` and `buildThreadCompactStartRequest` in app-server helpers.
- Add runtime convenience methods `setThreadName` and `compactThread` on `createCodexHostRuntime(...)`.
- Add tests covering request builders, runtime dispatch behavior, and in-flight lock enforcement.
- Document the new runtime thread control helpers in package docs.
