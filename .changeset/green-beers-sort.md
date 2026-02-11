---
"@zakstam/codex-local-component": minor
---

Introduce manifest-driven host surface generation and canonical single-path integration docs.

- Generate host `convex/chat.generated.ts` wrappers from a canonical preset manifest and keep app-owned endpoints in `chat.extensions.ts`.
- Add host surface generation/check tooling (`host:generate`, `host:check`) and shared wiring smoke checks across example and smoke hosts.
- Add host preset matrix generation + snapshot/contract tests for key parity across runtime-owned and dispatch-managed surfaces.
- Standardize docs around a single canonical consumer strategy in `LLMS.md` (runtime-owned default) with explicit advanced appendix boundaries.
- Add docs drift guardrail (`check:docs:single-path`) and include canonical docs files in package publish contents.
