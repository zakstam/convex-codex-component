---
"@zakstam/codex-local-component": minor
---

Expose display-friendly `preview` in `components.codexLocal.threads.list` rows so consumers can render stable thread labels without ID slicing.

- `threads.list` rows now include required `preview` (`threadHandle`, `preview`, `status`, `updatedAt`).
- Preview derivation is name-first (from `thread/name/updated` lifecycle events) with fallback to first user message text, then `"Untitled thread"`.
- Tauri example picker now consumes the shared `preview` contract instead of rendering truncated IDs.
