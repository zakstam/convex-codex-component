---
"@zakstam/codex-local-component": minor
---

External API simplification phase 2:
- Actor policy shorthand: accept string or `{ userId }` as `actorPolicy` in `createCodexHost`
- Unified `endpoints` property merging mutations and queries for single-destructure export
- Expanded surface manifest with server request and turn management endpoints (default enabled)
- `createConvexPersistence` factory absorbing session rollover, dispatch queue, and field mapping
- Convex-integrated `createCodexHostRuntime` overload accepting `convexUrl + chatApi + userId`
- Delta merge optimization in runtime core for consecutive `item/agentMessage/delta` events
- Unified `useCodex()` hook composing chat, token usage (auto-detected from context), and threads (opt-in)
- Reduced React export surface: 11 hooks internalized, `useCodex` + `useCodexRuntimeBridge` + `useCodexAccountAuth` + `useCodexThreadState` + `useCodexThreads` as primary API
- `CodexProvider` auto-threads `listTokenUsage` from api prop
