---
"@zakstam/codex-local-component": patch
---

Add a package-scoped `coverage` script for local coverage runs:

- Add `coverage` to `packages/codex-local-component/package.json`:
  `pnpm run build && NODE_V8_COVERAGE=coverage node --test --experimental-test-coverage test/*.test.mjs`
- Lets contributors run `pnpm --filter @zakstam/codex-local-component run coverage` without CI wiring.
