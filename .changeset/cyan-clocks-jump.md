---
"@zakstam/codex-local-component": patch
---

Add an explicit manual protocol-schema maintenance workflow with fail-closed validation.

- Add `schema:sync`, `schema:check`, and `schema:verify` package scripts.
- Add schema sync/check scripts with a committed schema manifest for drift detection.
- Gate protocol/schema path changes in CI with `schema:check` and `schema:verify`.
- Document maintainer schema update commands and required source inputs.
