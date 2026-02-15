---
"@zakstam/codex-local-component": minor
---

Add a Tauri example Tool Policy panel and bridge support for disabling dynamic tools at runtime.

The new UI in the Tauri example allows blocking named dynamic tools from the sidebar. The bridge now accepts `set_disabled_tools` from Rust/React, synchronizes the policy in bridge state, and enforces it in the helper before invoking any dynamic tool execution.
