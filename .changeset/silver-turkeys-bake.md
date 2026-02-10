---
"@zakstam/codex-local-component": patch
---

Adjust command-execution durable message text to store the command string rather than aggregated command output.

This supports UIs that show tool-call identity (for example, the command that was run) while suppressing tool output/result text from the chat flow.
