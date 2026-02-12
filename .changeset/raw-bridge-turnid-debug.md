---
"@zakstam/codex-local-component": patch
---

Add bridge-level raw app-server ingress logging behind `CODEX_BRIDGE_RAW_LOG` (`all` or `turns`) so hosts can verify exact pre-parse protocol lines.

Also harden runtime turn-id mapping so runtime-emitted ids can be remapped to persisted claimed turn ids before ingest persistence.
