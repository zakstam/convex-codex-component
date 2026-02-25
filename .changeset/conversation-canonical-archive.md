---
"@zakstam/codex-runtime": minor
---

Add conversation-canonical archive support across host/runtime/component surfaces.

- Add conversation lifecycle request builders and runtime helpers (`newConversation`, `resumeConversation`, `listConversations`, `forkConversation`, `archiveConversation`, `interruptConversation`, `getConversationSummary`).
- Add conversation-scoped host archive endpoints (`archiveConversationThread`, `unarchiveConversationThread`, `listThreadsForConversation`).
- Persist `conversationId` on thread bindings and enforce conversation/thread match checks for archive mutations.
- Preserve archive as a soft lifecycle state and stop generic thread touch paths from implicitly forcing archived threads back to active.
