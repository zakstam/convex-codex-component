---
"@zakstam/codex-runtime": minor
---

Extract protocol schema maintenance scripts into `@zakstam/codex-runtime-protocol-tooling`.

- Move schema sync/check tooling out of core package script ownership.
- Delegate core `schema:sync` and `schema:check` commands to the tooling package.
- Keep runtime protocol parser/classifier/event code in core runtime package.
