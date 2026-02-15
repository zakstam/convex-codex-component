---
"@zakstam/codex-local-component": minor
---

Refactor runtime and component internals to reduce implicit state handling, normalize terminal statuses, and centralize shared contracts.

- Normalize runtime terminal mapping to canonical `interrupted` status (instead of `cancelled`) for turn completion handling.
- Extract sync validators into a dedicated `component/validators` module to reduce inline validator sprawl in endpoint files.
- Replace string-concatenated ingest cache keys with nested map structures keyed by turn and id.
- Centralize repeated numeric limits into shared constants and apply them across thread snapshot reads, deletion scans, and runtime idle flush scheduling.
- Add coded not-found errors (`E_THREAD_NOT_FOUND`, `E_TURN_NOT_FOUND`, `E_STREAM_NOT_FOUND`) and improve auth error messaging consistency.
- Centralize thread snapshot query loading via a repository helper to reduce scattered inline query logic.
