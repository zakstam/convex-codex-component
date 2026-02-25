---
"@zakstam/codex-runtime": minor
---

Adopt adapter-first host runtime configuration and remove runtime mode constructor APIs.

- `createCodexHostRuntime` now accepts optional `persistence` adapter instead of mode-based setup.
- Core package is persistence-engine-agnostic; Convex adapter implementation moved out of core.
- Added dedicated Convex persistence adapter package (`@zakstam/codex-runtime-convex`) for Convex-backed runtime persistence.
