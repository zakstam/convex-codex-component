---
"@zakstam/codex-local-component": patch
---

Improve React hook typing so external consumers can avoid manual casts.

- Add generic callback-result inference to `useCodexAccountAuth` and `useCodexRuntimeBridge`.
- Remove repeated per-hook `OptionalRestArgsOrSkip` cast patterns by centralizing query-arg conversion in one helper.
- Remove the `useCodexConversationController` fallback cast when deriving the dynamic-tools query source.
- Update React/client docs and API reference to reflect the stronger consumer-facing type contracts.
