---
"@zakstam/codex-local-component": minor
---

Add a high-level `useCodexConversationController` React hook that bundles messages, activity, ingest health, branch activity, composer, and interrupt state/actions.

Promote React hooks as the official integration recommendation, expose controller support in the React+Convex adapter, and document the Tauri app as the blessed reference wiring.

Harden host runtime ingest flushing by treating `ingestSafe` rejections with only `OUT_OF_ORDER` errors as non-fatal dropped batches, preventing repeated protocol flush failures.
