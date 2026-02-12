---
"@zakstam/codex-local-component": minor
---

Add per-turn token usage tracking and inline display in the tauri example app

- New component-level `tokenUsage` module with `upsert` mutation and `listByThread` query
- New `useCodexTokenUsage` React hook and `CodexTokenUsage` / `CodexTokenUsageBreakdown` types exported from `react` entrypoint
- Host preset wires `upsertTokenUsageForHooks` mutation and `listTokenUsageForHooks` query
- Tauri app shows a compact per-turn token label (total / in / out) beneath the last assistant message of each turn
