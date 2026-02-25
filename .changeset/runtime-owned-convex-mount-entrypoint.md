---
"@zakstam/codex-runtime": patch
"@zakstam/codex-runtime-convex": patch
---

Fix Convex component mount ownership so host wiring preflight checks resolve the canonical `codexLocal` component surface.

- Canonical mount import is now `@zakstam/codex-runtime/convex.config`.
- Runtime package now exports `./convex.config` for app `convex/convex.config.ts` usage.
- Remove the `@zakstam/codex-runtime-convex/convex.config` public export to fail closed on stale mount paths.
- Update example app mounts, mount-import validation checks, and integration docs to the runtime-owned mount path.
