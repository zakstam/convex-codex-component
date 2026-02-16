---
"@zakstam/codex-local-component": patch
---

Fix `withServerActor` to preserve the request actor's userId for runtime-owned profiles. Previously, when `serverActor` had no `userId` (the default for runtime-owned endpoints), the request actor was unconditionally replaced with the empty server actor, causing all component data to be scoped under the anonymous user scope. Now the request actor is preserved when the server actor has no `userId`, so preset mutations and queries correctly scope data to the authenticated user.
