---
"@zakstam/codex-local-component": patch
---

Strengthen `createCodexHost` wrapper contract typing so incompatible wrapper signatures are rejected at compile time instead of degrading endpoint contracts.

Add compile-time host wrapper contract coverage and tighten wrapper result fallback behavior for safer endpoint typing.

Harden CI by validating `@zakstam/codex-local-component` with the correct package filter and adding a tauri host/type contract gate when boundary files change.
