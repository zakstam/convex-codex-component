---
"@zakstam/codex-local-component": minor
---

Add first-class reasoning stream support across the component, client, host wrappers, and React hooks.

- Parse and normalize `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, and `item/reasoning/textDelta` into canonical reasoning deltas.
- Persist reasoning segments (`codex_reasoning_segments`) and expose paginated reasoning queries.
- Add dedicated consumer APIs: `listReasoningByThread`, `useCodexReasoning`, and `useCodexStreamingReasoning`.
- Add sync runtime controls: `saveReasoningDeltas` (default `true`) and `exposeRawReasoningDeltas` (default `false`).
- Update host helpers/docs and Tauri example integration so reasoning can be surfaced in chat flow with distinct reasoning styling.
