---
"@zakstam/codex-runtime": patch
---

Fix runtime lifecycle/send-gating edge cases across the host runtime and Tauri helper bridge.

- Use runtime turn IDs (not persisted IDs) for runtime control RPCs (`turn/steer`, `turn/interrupt`) after turn-ID remapping.
- Expire pending server requests on terminal events using canonical persisted turn identity, including remapped runtime turn IDs.
- Ensure queued interrupt intent is cleared when `turn/start` fails so it does not leak into later turns.
- Fail-close accepted turn sends when dispatch claim fails, and persist accepted-send failure state.
- Keep runtime teardown deterministic on `stop()` even when ingest flush fails.
- Make helper interrupt fail closed when runtime is not started.
