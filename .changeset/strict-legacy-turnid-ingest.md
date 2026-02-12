---
"@zakstam/codex-local-component": patch
---

Harden host ingest turn-id authority and mixed-mode ingest contracts.

- Reject `codex/event/*` ingest entries that do not carry canonical payload turn id (`msg.turn_id` or `msg.turnId`).
- Reject `turn/started` and `turn/completed` stream deltas when canonical payload turn id is missing.
- Remove mixed-mode untyped ingest coercion and require explicit typed ingest envelopes (`stream_delta` or `lifecycle_event`).
- Add safe ingest error mapping/code for missing canonical legacy turn id.
- Add safe ingest error mapping/code for missing canonical turn lifecycle payload turn id.
- Update host docs and tests to reflect strict typed ingest and fail-closed legacy turn-id behavior.
