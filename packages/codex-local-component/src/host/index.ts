// All Convex-safe exports (validators, actor wrappers, endpoint definers, error classifiers)
export * from "./convex-entry.js";

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
  type HostRuntimeState,
} from "./runtime.js";

// Non-Convex normalization helpers
export {
  normalizeInboundDeltas,
  type NormalizedInboundDelta,
  type NormalizedInboundLifecycleEvent,
  type NormalizedInboundStreamDelta,
} from "./normalizeInboundDeltas.js";

// Non-Convex ingest recovery
export { hasRecoverableIngestErrors, type HostIngestErrorLike } from "./ingestRecovery.js";

// Convex-integrated persistence adapter factory
export {
  createConvexPersistence,
  type ConvexPersistenceChatApi,
  type ConvexPersistenceOptions,
} from "./convexPersistence.js";

// Non-Convex: additional convexSlice exports only available at host level
export {
  listTokenUsageForHooksForActor,
  upsertTokenUsageForActor,
} from "./convexSlice.js";

// Tauri host adapter helpers
export * from "./tauri.js";
// Folded-in: bridge (previously @zakstam/codex-local-component/bridge)
export * from "../local-adapter/bridge.js";

// Folded-in: app-server (previously @zakstam/codex-local-component/app-server)
export * from "../app-server/index.js";
export type {
  ThreadHandle,
  ThreadHandleIdentity,
  RuntimeThreadLocator,
  ThreadLocator,
} from "../shared/threadIdentity.js";
