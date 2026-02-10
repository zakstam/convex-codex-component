---
"@zakstam/codex-local-component": patch
---

Improve streaming ingest throughput by coalescing durable message patches and batching stream stat updates during ingest.

Align host and React streaming payload contracts so `streams` are included with `{ kind: "deltas" }` responses, enabling a single-query overlay flow.

Update host/hook docs and wrapper tests for the refreshed replay/deltas contract.
