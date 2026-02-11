---
"@zakstam/codex-local-component": minor
---

Hardened runtime and protocol error handling to fail closed instead of silently defaulting, with explicit terminal/runtime error codes and stricter parsing for terminal events, managed server requests, keyset cursors, and stored server-request questions.

Added CI enforcement via `check:error-discipline` to block common silent-error patterns (empty catches, swallowed rejection chains, and legacy terminal fallback literals), plus expanded test coverage for malformed payload and strict-cursor scenarios.
