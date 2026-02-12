---
"@zakstam/codex-local-component": patch
---

Fix risky fallback defaults across the component: use `??` instead of `||` for text overlay to preserve empty strings, fix operator precedence in batch limit calculation, explicitly set status on serialized messages, simplify dead-code `threadId ?? userId!` to `threadId`, and centralize `streamsInProgress` default to a single normalization point.
