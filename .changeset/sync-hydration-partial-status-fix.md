---
"@zakstam/codex-runtime": patch
---

Fix sync hydration message badge mapping so `partial` is no longer treated as `failed`.

- Add per-message sync meta status support for `partial`.
- Map local snapshot messages to `partial` when hydration state is partial.
- Keep `failed` badges for true failed/drifted states only.
