---
"@zakstam/codex-local-component": minor
---

Add full app-server thread lifecycle support to the package runtime and helpers.

- Add typed app-server builders for `thread/resume`, `thread/fork`, `thread/read`, `thread/list`, `thread/loaded/list`, `thread/archive`, `thread/unarchive`, and `thread/rollback`.
- Extend `createCodexHostRuntime` with startup strategies (`start`/`resume`/`fork`) and runtime thread lifecycle methods.
- Expand `@zakstam/codex-local-component/client` thread helper exports (`createThread`, `resolveThread`, `resumeThread`, `resolveThreadByExternalId`, `getExternalThreadMapping`, `listThreads`).
- Add lifecycle-focused runtime and helper test coverage and documentation updates.
