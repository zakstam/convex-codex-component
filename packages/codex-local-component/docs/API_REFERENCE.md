# API Reference

This is a concise, consumer-first map of the APIs you need to get started.

Use this file when choosing the first import path and the high-signal APIs for your layer.
For the full type surface, use TypeScript completion or generated declarations.
The entries here are curated to match what consumers can import directly from package exports.

## Recommended path

Pick one path first, then expand only where needed:

- **UI-first apps:** `@zakstam/codex-local-component/react` + `@zakstam/codex-local-component/react-integration`
- **Host + Convex wiring:** `@zakstam/codex-local-component/host/convex` + `@zakstam/codex-local-component/host`
- **Protocol/debug tooling:** `@zakstam/codex-local-component/protocol` + `@zakstam/codex-local-component/app-server` + `@zakstam/codex-local-component/bridge`

If you are unsure, start with one path and stay there until it works, then layer in the next path.

## `@zakstam/codex-local-component`

Aggregate entrypoint used by consumers that want one import.

| API | What it gives you |
| --- | --- |
| `CodexDurableMessageLike` | Persisted message record shape used to build UI-ready rows. |
| `CodexStreamDeltaLike` | Stream delta input unit with cursor and kind metadata. |
| `CodexReasoningSegmentLike` | Raw reasoning segment input used by overlay merges. |
| `CodexReasoningOverlaySegment` | Overlay reasoning format used before final UI composition. |
| `CodexOverlayMessage` | Stream overlay message shape for in-flight turns. |
| `CodexOverlayReasoningSegment` | Overlay reasoning segment in a stream-safe form. |
| `extractCodexOverlayMessages` | Merges stream deltas into overlay message state. |
| `extractCodexReasoningOverlaySegments` | Merges reasoning deltas into overlay reasoning state. |
| `aggregateCodexReasoningSegments` | Stabilizes and orders reasoning segments. |
| `toCodexUIMessage` | Converts persisted data into a UI message shape. |
| `mergeCodexDurableAndStreamMessages` | Finalizes durable + stream message views for rendering. |
| `CodexActorContext` | Canonical actor argument contract for all API calls. |
| `CodexUIMessage` | Main UI message type returned by message-focused hooks/queries. |
| `CodexComponent` | Type alias for the component API surface. |
| `CodexQueryRunner` | Query runner context contract for host/component calls. |
| `CodexMutationRunner` | Mutation runner context contract for host/component calls. |
| `CodexMessageDoc` | Raw persisted message document type. |
| `CodexReasoningSegment` | Persisted reasoning segment type. |
| `CodexStreamOverlay` | Stream overlay return type from replay. |
| `CodexSyncRuntimeOptions` | Runtime options for stream sync operations. |

## `@zakstam/codex-local-component/react`

Primary consumer surface for UI apps.

| API | What you use it for |
| --- | --- |
| `useCodexConversationController` | Most complete UI integration: messages, state, composer, approvals, and interrupt flow. |
| `useCodexChat` | High-level conversation facade with message/activity/composer orchestration plus explicit tool policy controls (`disableTools`, `overrideToolHandler`, etc.). |
| `CodexChatOptions` | Configuration object for `useCodexChat` with built-in message, state, and tool policy inputs. |
| `CodexChatTools` | Tool policy control surface returned by `useCodexChat` (`disableTools`, `overrideToolHandler`, etc.). |
| `useCodexMessages` | Fetch paginated message history for chat views. |
| `useCodexStreamingMessages` | Stream overlay messages while preserving stream ordering. |
| `useCodexThreadState` | Show loading/spinner/error from thread lifecycle. |
| `useCodexThreadActivity` | Render live activity state (pending, completed, terminal). |
| `useCodexTurn` | Pull message + turn status in one cohesive view. |
| `useCodexApprovals` | Render and resolve approval workflows. |
| `useCodexDynamicTools` | Resolve and normalize dynamic tool calls from server requests. |
| `useCodexComposer` | Render composer state + send action for a thread. |
| `useCodexInterruptTurn` | Expose interrupt action with disabled/loading state. |
| `useCodexAutoResume` | Recover interrupted stream replay when process restarts. |
| `useCodexRuntimeBridge` | Run and monitor local bridge lifecycle for desktop/dev workflows. |
| `useCodexAccountAuth` | Handle login/logout flows from UI. |
| `useCodexThreads` | List and sync thread rows with paging. |
| `CodexConversationApprovalItem` | Normalized approval row payload for UI. |
| `CodexConversationApprovalDecision` | Decision payload used when approving tool/file requests. |
| `CodexDynamicToolServerRequest` | Typed incoming tool request contract for UI adapters. |
| `CodexTokenUsage` | Read spend summaries and attribution for reporting views. |

## `@zakstam/codex-local-component/react-integration`

Small adapter layer for hook-based applications already using host hooks.

| API | What it gives you |
| --- | --- |
| `createCodexReactConvexAdapter` | Build a ready-made adapter over app Convex hooks. |
| `codexThreadScopeArgs` | Normalize `(actor, threadId)` arguments safely. |
| `codexThreadTurnScopeArgs` | Normalize `(actor, threadId, turnId)` arguments safely. |
| `CodexThreadScopeArgs` | Typed actor/thread context for adapter construction. |
| `CodexThreadTurnScopeArgs` | Typed actor/thread/turn context for turn-level adapters. |
| `CodexReactHostHooks` | Contract expected from host-side hooks to use adapters. |
| `CodexReactConversationControllerOptions` | Adapter options for composer, approvals, and interrupts. |

## `@zakstam/codex-local-component/host`

Runtime ownership and host wiring for Convex surface generation.

| API | What it gives you |
| --- | --- |
| `createCodexHostRuntime` | Create the runtime process adapter used by app-server bridge consumers. |
| `defineRuntimeOwnedHostEndpoints` | Generate canonical runtime-owned Convex wrappers. |
| `defineRuntimeOwnedHostSlice` | Build a runtime-owned host slice definition. |
| `wrapHostDefinitions` | Re-wrap generated endpoint definitions for export. |
| `HOST_PRESET_DEFINITIONS` | Canonical built-in surface definitions for host setup. |
| `HOST_SURFACE_MANIFEST` | Shared manifest of host mutation/query capabilities. |
| `ingestBatchSafe` | Entry-point ingestion for mixed event + delta input. |
| `listThreadMessagesForHooks` | Host-facing query for hook-safe message reads. |
| `listThreadReasoningForHooks` | Host-facing query for reasoning reads. |
| `normalizeInboundDeltas` | Normalize stream deltas before persistence calls. |
| `computeDataHygiene` | Readable summary for retention/hygiene workflows. |
| `computePersistenceStats` | Compute storage/persistence diagnostics. |
| `ensureSession` | Persist or resolve session state for host operations. |
| `ensureThreadByCreate` | Create or load host thread context. |
| `ensureThreadByResolve` | Resolve thread by host mapping inputs. |
| `threadSnapshotSafe` | Read terminal-aware thread snapshot for orchestration. |
| `listPendingApprovalsForHooksForActor` | Actor-scoped approval query helper used by UI hooks. |
| `respondApprovalForHooksForActor` | Persist approval decisions from UI/runtime adapters. |

## `@zakstam/codex-local-component/host/convex`

Convex boundary surface to import only in Convex server files (`convex/chat.ts`, etc.).

| API | What it gives you |
| --- | --- |
| `defineRuntimeOwnedHostEndpoints` | Build runtime-owned preset endpoints for host files. |
| `defineRuntimeOwnedHostSlice` | Define a runtime-owned host slice from Convex runtime context. |
| `wrapHostDefinitions` | Export-ready wrapper for generated endpoint sets. |
| `HOST_PRESET_DEFINITIONS` | Built-in preset endpoints and role map. |
| `HOST_SURFACE_MANIFEST` | Canonical mutation/query manifest for boundary wiring. |
| `ingestBatchSafe` | Convex-safe ingestion helper for mixed incoming events. |
| `computeDataHygiene` | Convex-safe hygiene metrics query builder. |
| `computeDurableHistoryStats` | Convex-safe durable history metrics query builder. |
| `computePersistenceStats` | Convex-safe persistence metrics query builder. |
| `listThreadMessagesForHooksForActor` | Convex query for actor-scoped thread messages. |
| `listThreadReasoningForHooksForActor` | Convex query for actor-scoped reasoning messages. |
| `listPendingApprovalsForHooksForActor` | Convex query for actor-scoped approvals. |
| `listPendingServerRequestsForHooksForActor` | Convex query for actor-scoped server requests. |

## `@zakstam/codex-local-component/app-server`

High-signal request builders for Codex app-server wire calls.

| API | What you use it for |
| --- | --- |
| `buildClientRequest` | Create a base typed client request wrapper. |
| `buildInitializeRequestWithCapabilities` | Initialize app-server sessions with explicit capabilities. |
| `buildInitializedNotification` | Report the completed initialize state. |
| `buildThreadStartRequest` | Start a thread with a typed request. |
| `buildThreadResumeRequest` | Resume a thread with typed request shape. |
| `buildThreadForkRequest` | Fork a thread in app-server protocol terms. |
| `buildThreadReadRequest` | Read a thread by request context. |
| `buildThreadListRequest` | List threads with canonical list request payload. |
| `buildThreadLoadedListRequest` | Load history-style thread listing payload. |
| `buildThreadArchiveRequest` | Archive thread request payload. |
| `buildThreadUnarchiveRequest` | Unarchive thread request payload. |
| `buildTurnStartRequest` | Start a turn with typed payload. |
| `buildTurnInterruptRequest` | Interrupt a running turn via app-server protocol. |
| `buildCommandExecutionApprovalResponse` | Build response payload for command approval tool calls. |
| `buildDynamicToolCallResponse` | Build response for dynamic tool invocation completion. |

## `@zakstam/codex-local-component/protocol`

Message protocol parsing and classification primitives.

| API | What you use it for |
| --- | --- |
| `parseWireMessage` | Parse one protocol wire line into typed inbound message data. |
| `assertValidClientMessage` | Validate outbound messages before writing/forwarding. |
| `CodexProtocolParseError` | Catch protocol parse failures with typed context. |
| `CodexProtocolSendError` | Catch outbound protocol validation failures. |
| `classifyMessage` | Determine if a server message is thread-scoped or global. |
| `extractStreamId` | Read stream id when present in inbound messages. |
| `extractTurnId` | Read turn id when present in inbound messages. |
| `v2` | Access the generated v2 protocol schema namespace. |

## `@zakstam/codex-local-component/bridge`

Local runtime bridge for spawning/feeding the codex app-server process.

| API | What it gives you |
| --- | --- |
| `CodexLocalBridge` | Spawn, monitor, and stop a local codex app-server process. |
| `BridgeConfig` | Configure bridge process path and working directory. |
| `BridgeHandlers` | Implement event/protocol/error callbacks. |
| `BridgeError` | Standard error envelope for protocol callback failures. |

## `@zakstam/codex-local-component/convex.config`

| API | What it gives you |
| --- | --- |
| `default` | Convex component registration for `defineComponent("codexLocal")`. |

## `@zakstam/codex-local-component/errors`

Shared error helpers used across host and Convex boundary surfaces.

| API | What it is for |
| --- | --- |
| `RECOVERABLE_INGEST_ERROR_CODES` | Shared set of recoverable ingest codes. |
| `parseErrorCode` | Extract canonical uppercase error code from unknown values. |
| `isThreadMissing` | Check if an error means thread/session context is missing. |
| `isThreadForbidden` | Check if an error is thread-level access denied. |
| `isSessionForbidden` | Check if an error is session-level access denied. |
| `isRecoverableIngestError` | Check whether an error is safe to retry for ingest pipelines. |

## Complete API Discovery

This page is a curated quick-start map.
For complete export surfaces, use your editor's TypeScript completion on:

- `@zakstam/codex-local-component`
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/react-integration`
- `@zakstam/codex-local-component/host`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/app-server`
- `@zakstam/codex-local-component/protocol`
- `@zakstam/codex-local-component/bridge`
- `@zakstam/codex-local-component/errors`
