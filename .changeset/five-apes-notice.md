---
"@zakstam/codex-local-component": patch
---

Contain generated Convex typing looseness at a single host-internal boundary.

- Add `src/host/generatedTypingBoundary.ts` to normalize host component refs without leaking casts into handwritten host/runtime flows.
- Refactor `defineCodexHostSlice` to use the shared boundary resolver and remove inline component-cast plumbing.
- Update client/API docs to clarify that generated component typing gaps are internalized so external consumers do not need casts.
