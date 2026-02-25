---
"@zakstam/codex-runtime": patch
"@zakstam/codex-runtime-convex": patch
---

Make runtime package builds non-destructive during normal development flows.

- Remove implicit `clean` from `build` scripts in `@zakstam/codex-runtime` and `@zakstam/codex-runtime-convex`.
- Keep explicit `clean` scripts available for intentional artifact resets.
- Prevent transient missing-`dist` module resolution failures when multiple app terminals run runtime prepare/build steps concurrently.
