---
"@zakstam/codex-local-component": patch
---

Standardize host thread read APIs on safe-result behavior.

- Remove `threadSnapshotSafe` and strict throw-mode read aliases from public host surface and generated shims.
- Keep `threadSnapshot` safe-by-default, returning thread-status payloads for missing/forbidden reads and only throwing for unexpected runtime failures.
- Update dependent example usage and docs to align with the safe read contract.
