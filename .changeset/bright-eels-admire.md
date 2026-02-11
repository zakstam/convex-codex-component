---
"@zakstam/codex-local-component": minor
---

Make dispatch ownership explicit in host runtime with mode-gated APIs and stronger orchestration guardrails.

- Require `dispatchManaged: true | false` in `createCodexHostRuntime().start(...)`.
- Split turn entrypoints by ownership mode:
  - `sendTurn(...)` for runtime-owned orchestration (`dispatchManaged: false`)
  - `startClaimedTurn(...)` for externally claimed dispatch execution (`dispatchManaged: true`)
- Add explicit runtime dispatch error codes for mode conflicts, invalid claims, in-flight turn conflicts, and missing mode.
- Add `normalizeInboundDeltas(...)` host helper and apply canonical inbound normalization before strict ingest.
- Add unified dispatch observability projection helpers (queue + claim + runtime + turn + correlation IDs).
- Extend dispatch state with `claimToken` and update smoke/example wrappers to the explicit ownership contract.
- Add runtime-mode coverage in host/runtime and host/wrapper tests.
- Publish separate reference docs for runtime-owned and dispatch-managed modes.
