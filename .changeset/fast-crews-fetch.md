---
"@zakstam/codex-local-component": patch
---

Refactor sync ingest into a staged internal pipeline under `src/component/ingest` and keep `syncIngest.ts` as a thin facade.

Add targeted ingest pipeline tests for normalization, turn signal collection, and ingest-safe error classification.
