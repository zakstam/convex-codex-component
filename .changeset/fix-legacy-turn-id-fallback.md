---
"@zakstam/codex-local-component": patch
---

Fix turn-id canonicalization for ingest and legacy envelopes:
- Ignore legacy `codex/event/*` envelope `params.id` when extracting turn ids (accept only explicit `msg.turn_id` / `msg.turnId`).
- During ingest normalization, prefer payload-derived turn ids and fail closed when lifecycle payloads do not carry a canonical turn id, so synthetic turn `"0"` cannot be materialized.
- Add a release-smoke package freshness check that fails if an installed package still contains legacy `params.id` turn-id fallback logic.
