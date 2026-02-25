# Codex Runtime Rename Inventory

Date: 2026-02-22
Scope: full rename migration planning baseline

## Summary

- Total matching references for legacy naming tokens (`codex-local-component`, `codex-convex-component`, `codex-local-`): 378
- First migration slice targets manifest/package-manager wiring only.

## Priority Touchpoints

1. Monorepo root scripts
- `codex-convex-component/package.json`

2. Published package manifests
- `codex-convex-component/packages/codex-runtime/package.json`
- `codex-convex-component/packages/codex-runtime-convex/package.json`

3. Example app manifests
- `codex-convex-component/apps/examples/cli-app/package.json`
- `codex-convex-component/apps/examples/persistent-cli-app/package.json`
- `codex-convex-component/apps/examples/tauri-app/package.json`
- `codex-convex-component/apps/examples/debug-harness/package.json`

4. Remaining categories (deferred to later migration tasks)
- Source imports and internal identifiers
- Docs and runbooks
- Changesets/changelogs
- CI check scripts and guards

## Notes

- The repository currently has unrelated in-flight changes. Rename work should avoid reverting or reshaping those changes.
- This inventory is a baseline artifact and should be updated as each migration stage lands.
