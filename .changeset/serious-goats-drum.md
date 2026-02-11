---
"@zakstam/codex-local-component": minor
---

Refactor host helper APIs to remove implicit trusted-actor behavior and make actor injection explicit in host apps.

- Rename host helper exports from `*WithTrustedActor` to `*ForActor`.
- Remove `trustedActorFromEnv` export from host helper surfaces.
- Update example and smoke host wrappers to pass an explicit server actor for trusted execution paths.
- Fix server-request upsert/resolve matching by keying on `requestIdType + requestIdText` and add the corresponding schema index.
- Update host slice tests to match renamed helper APIs.
