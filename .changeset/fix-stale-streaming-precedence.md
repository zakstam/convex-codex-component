---
"@zakstam/codex-local-component": patch
---

Fix `useCodexThreadActivity` stale-streaming precedence so stale `streaming` messages do not override newer terminal boundaries from completed/failed/interrupted signals.
