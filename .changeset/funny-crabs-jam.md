---
"@zakstam/codex-local-component": patch
---

Fix host component ref normalization to support proxy-like `components` objects that expose `codexLocal` via property get traps. This prevents runtime failures when resolving thread mutations in external consumer integrations.
