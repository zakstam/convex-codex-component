---
"@zakstam/codex-local-component": minor
---

Consolidate export paths from 11 to 7. Remove `./errors`, `./bridge`, and `./app-server` as separate entry points. Bridge and app-server exports are now available from `./host`. Error exports remain available from the default entry point (`.`) and `./host`. Consumers importing from the removed paths should update to `@zakstam/codex-local-component/host`.
