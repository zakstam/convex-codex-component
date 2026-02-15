---
"@zakstam/codex-local-component": patch
---

Harden linting coverage and expose lint scripts across the published package and app surfaces.

- Add a workspace `lint` script in `package.json` targeting only intended TS/TSX source trees and switch release prechecks to use it.
- Expand root ESLint target files to include the Tauri example and component package sources, plus TSX files.
- Add explicit root excludes for `submodules/**`, `**/src-tauri/**`, `**/target/**`, and generated bundle assets.
- Add `lint` scripts to `packages/codex-local-component` and `apps/examples/tauri-app`.
- Update docs to reflect the new lint commands in onboarding and app checks.
