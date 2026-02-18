## Summary

- What changed:
- Why:

## Validation

- [ ] `pnpm run release:precheck` passed locally
- [ ] Added a `.changeset/*.md` entry for package-facing changes (or confirmed none needed)
- [ ] If schemas/indexes changed, data hygiene checks remain clean (`streamStatOrphans = 0`)

## Architecture Guardrails

- [ ] No unsafe type assertions (`as`) were introduced in host app runtime/wrapper paths
- [ ] No new `any` usage was introduced in host app runtime/wrapper paths
- [ ] Wrapper contracts are covered by verification checks (shape and behavior)
- [ ] Lifecycle changes include cleanup paths and invariant checks
- [ ] Scope is forward-looking only (no legacy shims/back-compat layers added)
