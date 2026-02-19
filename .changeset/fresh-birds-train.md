---
"@zakstam/codex-local-component": patch
---

Fix a Node ESM runtime import crash when importing `@zakstam/codex-local-component/protocol`.

- Avoid unsupported ESM directory imports by re-exporting protocol schema `v2` via an explicit file path (`./v2/index.js`).
- Add a regression test that verifies the protocol entrypoint imports successfully in Node ESM.
- Exclude generated Convex component files from repo linting to prevent non-actionable generated-file warnings.
