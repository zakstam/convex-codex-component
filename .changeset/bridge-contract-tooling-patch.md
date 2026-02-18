---
"@zakstam/codex-local-component": patch
---

Improve Tauri example bridge wiring maintainability with a schema-first command contract and generated cross-layer artifacts.

### Improvements

- Add canonical bridge command contract and generators for Tauri invoke wrappers, helper command typing/parsing, Rust command constants, and Tauri permission files.
- Add contract verification scripts/tests and document the workflow in Tauri example docs and runbook.
- Keep example app lint and type checks green after migration, including TS lint scope coverage for `src-node` and stricter typing in Convex host wrappers.
