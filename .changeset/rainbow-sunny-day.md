---
"@zakstam/codex-local-component": patch
---


Refactor across component source, config, and example apps.

- Extract shared deletion utilities (UUID generation, delay clamping, deleted-counts parsing) into `deletionUtils.ts`, removing 3 sets of duplicated functions from `threads.ts`, `turns.ts`, and `deletionInternal.ts`.
- Split `threads.ts` by extracting validators into `threadValidators.ts` and internal helpers into `threadHelpers.ts`, reducing the file from 850 to 632 lines.
- Replace all `void error;` silent error swallowing (6 occurrences) with `console.warn` for debuggability.
- Expand ESLint config with `no-unused-vars`, `no-floating-promises`, and `prefer-const` rules; fix all violations.
- Add `@types/react` as optional peer dependency to match the existing `react` peer dep pattern.
