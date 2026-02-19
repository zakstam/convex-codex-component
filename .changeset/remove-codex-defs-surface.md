---
"@zakstam/codex-local-component": patch
---

Remove `createCodexHost(...).defs` from the runtime facade and standardize host endpoint exports on `codex.endpoints`.

- Keep `createCodexHost` wrapper-driven public runtime surface as `mutations`, `queries`, and `endpoints`.
- Update the Tauri example and canonical docs to export `api.chat.*` from `codex.endpoints`.
- Keep host definition types available for compile-time contracts while dropping the runtime `defs` escape hatch.
