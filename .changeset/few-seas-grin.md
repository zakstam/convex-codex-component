---
"@zakstam/codex-local-component": patch
---

Improve external consumer type-safety across React hooks and adapter contracts.

- Add generic callback-result inference to `useCodexConversationController`, `useCodexChat`, and `createCodexReactConvexAdapter(...).useConversationController(...)` for `composer`, `approvals`, `interrupt`, and dynamic-tool `respond` handlers.
- Add generic result inference to `useCodexThreads` controls (`createThread`, `resolveThread`, `resumeThread`) to reduce downstream casts.
- Harden `useCodexDynamicTools` against non-matching query payloads by deriving calls only from validated server-request rows.
- Tighten host preset definitions by making preflight checks explicitly `Promise<void>` and adding an explicit `returns` validator for `ensureThread`.
- Update React/client docs and API reference to reflect the stronger consumer typing contracts.
