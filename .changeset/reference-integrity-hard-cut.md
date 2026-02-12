---
"@zakstam/codex-local-component": patch
---

Enforce Convex reference integrity across persisted Codex state tables by adding canonical `v.id(...)` relationships (thread/turn/stream refs), wiring write paths to populate and validate those refs, and keeping cascade delete behavior as the default cleanup model.

Also canonicalize runtime turn ids before side-channel persistence and add bounded retry behavior for pending server request writes that race ahead of turn persistence.
