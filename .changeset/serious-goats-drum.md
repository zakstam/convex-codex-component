---
"@zakstam/codex-local-component": minor
---

Refactor host helper APIs to remove implicit trusted-actor behavior and make actor injection explicit in host apps.

- Rename host helper exports from `*WithTrustedActor` to `*ForActor`.
- Remove `trustedActorFromEnv` export from host helper surfaces.
- Update example and smoke host wrappers to pass an explicit server actor for trusted execution paths.
- Fix server-request upsert/resolve matching by keying on `requestIdType + requestIdText` and add the corresponding schema index.
- Update host slice tests to match renamed helper APIs.
- Harden TypeScript safety across host/client/react/protocol paths by removing explicit `any` usage and tightening generic boundaries.
- Add `check:unsafe-types` CI guard plus cast allowlist maintenance script for handwritten source.
- Update integration docs to clarify Convex-safe protocol usage (`protocol/parser` is local runtime only; do not import it in Convex-deployed code).
