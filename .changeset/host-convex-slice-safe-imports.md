---
"@zakstam/codex-local-component": patch
---

Add shared host Convex wrapper primitives and validators to reduce duplicated `convex/chat.ts` logic across example/smoke apps.

Add a Node-safe host entrypoint (`@zakstam/codex-local-component/host/convex`) so Convex server files can import host helpers without pulling Node runtime bridge code into Convex bundling.

Migrate example/smoke host wrapper files and docs to the shared Convex host helpers and the new Convex-safe import path.
