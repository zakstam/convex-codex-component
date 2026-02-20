---
"@zakstam/codex-local-component": patch
---

Improve debug-harness verification ergonomics and reduce release-check friction.

- Auto-load `apps/examples/tauri-app/.env.local` in debug-harness defaults when present (while keeping process env override precedence).
- Write debug-harness trace artifacts to `apps/examples/debug-harness/.tmp/traces/` instead of a tracked path.
- Ignore debug-harness temp artifacts in repo `.gitignore`.
- Update debug-harness and runbook docs to reflect the new env-loading and artifact-path behavior.
