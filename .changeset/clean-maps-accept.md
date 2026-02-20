---
"@zakstam/codex-local-component": patch
---

Gate package publishing on successful `codex-local-component` CI runs on `main`, while keeping manual dispatch available for maintainers.

This release flow now publishes from the exact CI-validated commit SHA to avoid publishing unverified or drifted states.
