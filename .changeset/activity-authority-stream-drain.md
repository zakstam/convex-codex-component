---
"@zakstam/codex-local-component": patch
---

Make streaming activity authority deterministic across modes and stream cleanup timing

- Move thread/branch activity to a shared authority module with explicit precedence:
  pending approvals > streaming message > active stream > in-flight newer than terminal > terminal > idle
- Treat `activeStreams` as authoritative for stream-state-driven streaming and prevent stale `streamStats` rows from forcing streaming when no active stream exists
- Emit a canonical `stream/drain_complete` lifecycle marker when stream cleanup fully drains and consume it in activity derivation to exit streaming promptly
- Harden stream stat hygiene with monotonic state transitions and stale streaming-stat finalization when no matching active stream exists
- Add parity tests covering identical activity transitions for dispatch-managed and runtime-owned scenarios, including delayed/stale stream stats
