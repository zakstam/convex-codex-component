// Non-Convex host runtime
export {
  createCodexHostRuntime,
  CodexHostRuntimeError,
  type CodexHostRuntime,
  type CreateCodexHostRuntimeArgs,
  type HostRuntimeErrorCode,
  type HostRuntimeHandlers,
  type HostRuntimePersistence,
  type HostRuntimePersistedServerRequest,
  type HostRuntimeConnectArgs,
  type HostRuntimeOpenThreadArgs,
  type HostRuntimeThreadListItem,
  type HostRuntimeThreadListResult,
  type HostRuntimeState,
  type ActorContext,
  type IngestDelta,
} from "./runtime/index.js";

// Non-Convex normalization helpers
export {
  normalizeInboundDeltas,
  type NormalizedInboundDelta,
  type NormalizedInboundLifecycleEvent,
  type NormalizedInboundStreamDelta,
} from "./normalizeInboundDeltas.js";

// Non-Convex ingest recovery
export { hasRecoverableIngestErrors, type HostIngestErrorLike } from "./ingestRecovery.js";

// Folded-in: app-server (previously @zakstam/codex-runtime/app-server)
export * from "../app-server/index.js";
export type {
  ThreadHandle,
  ThreadHandleIdentity,
  RuntimeConversationLocator,
  ThreadLocator,
} from "../shared/threadIdentity.js";
