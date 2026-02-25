---
"@zakstam/codex-runtime": minor
---

Add codex-prefixed optimistic update APIs for React consumers, including:

- `createCodexOptimisticUpdate`
- `codexOptimisticOps`
- `useCodexOptimisticMutation`
- `codexOptimisticPresets` (message send + deletion status presets)

Also add bridge-friendly composer optimism via `composer.optimistic` in `useCodex` / `useCodexChat` flows and adopt optimistic deletion/composer behavior in the Tauri example app.

The legacy `optimisticallySendCodexMessage` export path is removed in favor of the new APIs.
