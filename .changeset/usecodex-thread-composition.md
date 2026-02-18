---
"@zakstam/codex-local-component": minor
---

useCodex() thread composition:
- `threadId` is now optional — when omitted with `threads` config, derived from picker selection
- `threadState` (raw snapshot) and `effectiveThreadId` exposed in return value
- Hook ordering fixed: threads runs before chat, enabling picker-driven message loading
- `useCodexThreads` removed from primary exports (use through `useCodex({ threads })`)
- `useCodexThreads` now auto-clears selection when the selected thread is removed from the list (graceful recovery after thread deletion)
