---
"@zakstam/codex-local-component": patch
---

Fix Node ESM compatibility for protocol and bridge imports by adding JSON import attributes in the protocol parser and using an explicit `./v2/index.js` export path in protocol schemas.
