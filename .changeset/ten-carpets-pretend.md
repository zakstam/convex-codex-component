---
"@zakstam/codex-local-component": minor
---

Remove legacy external-thread alias contracts and standardize on canonical thread-handle integration.

- Unify host, runtime, React, and component contracts on `threadHandle` and `*ByThreadHandle`.
- Remove legacy alias exports and type paths that referenced external-id naming.
- Align Tauri and persistent CLI example host surfaces with canonical query names.
- Tighten canonical docs and references to the single runtime-owned integration path.
