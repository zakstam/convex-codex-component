export {
  defineCodexHostDefinitions,
  type CodexHostDefinitions,
  type CodexHostSliceFeatures,
  type CodexHostSliceIngestMode,
  type CodexHostSliceProfile,
  type DefineCodexHostDefinitionsOptions,
  type RuntimeOwnedHostDefinitions,
} from "./definitions/index.js";
export type {
  RuntimeConversationLocator,
  ThreadLocator,
} from "../shared/threadIdentity.js";
export {
  HOST_SURFACE_MANIFEST,
  HOST_MUTATION_INTERNAL_ALIASES,
  HOST_QUERY_INTERNAL_ALIASES,
  HOST_CONTRACT_ARTIFACT,
  type HostSurfaceProfile,
  type HostSurfaceMutationKey,
  type HostSurfaceQueryKey,
  type HostContractProfile,
  type HostContractMutationKey,
  type HostContractQueryKey,
} from "./definitions/index.js";
export {
  renderCodexHostShim,
  type CodexHostShimRenderOptions,
} from "./definitions/index.js";

export {
  ingestBatchSafe,
  listThreadMessagesForHooks,
  listThreadReasoningForHooks,
  type HostInboundLifecycleEvent,
  type HostInboundStreamDelta,
  type HostMessagesForHooksArgs,
  type HostReasoningForHooksArgs,
  type HostStreamArgs,
  type HostSyncRuntimeOptions,
} from "./convex.js";

export {
  normalizeInboundDeltas,
  type NormalizedInboundDelta,
  type NormalizedInboundLifecycleEvent,
  type NormalizedInboundStreamDelta,
} from "./normalizeInboundDeltas.js";

export {
  RECOVERABLE_INGEST_ERROR_CODES,
  classifyThreadReadError,
  isRecoverableIngestError,
  isSessionForbidden,
  isThreadForbidden,
  isThreadMissing,
  isTurnNotFound,
  parseErrorCode,
} from "../errors.js";

export {
  computeDataHygiene,
  computeDurableHistoryStats,
  computePersistenceStats,
  dataHygiene,
  durableHistoryStats,
  ensureSession,
  ensureConversationBindingByCreate,
  ensureConversationBindingByResolve,
  appendConversationSyncSourceChunkForActor,
  cancelConversationSyncJobForActor,
  forceRebindConversationSyncForActor,
  getConversationSyncJobForActor,
  ingestBatchMixed,
  ingestBatchStreamOnly,
  ingestEventMixed,
  ingestEventStreamOnly,
  interruptTurnForHooksForActor,
  isStreamStatSummary,
  listPendingApprovalsForHooksForActor,
  listConversationSyncJobsForActor,
  listPendingServerRequestsForHooksForActor,
  listThreadMessagesForHooksForActor,
  listThreadReasoningForHooksForActor,
  listTurnMessagesForHooksForActor,
  markConversationSyncProgressForActor,
  persistenceStats,
  respondApprovalForHooksForActor,
  resolvePendingServerRequestForHooksForActor,
  threadSnapshot,
  syncOpenConversationBindingForActor,
  startConversationSyncSourceForActor,
  sealConversationSyncSourceForActor,
  upsertPendingServerRequestForHooksForActor,
  upsertTokenUsageForActor,
  listTokenUsageForHooksForActor,
  vHostActorContext,
  vHostDataHygiene,
  vHostDurableHistoryStats,
  vHostTurnInput,
  vHostEnsureSessionResult,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostPersistenceStats,
  vHostStreamArgs,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
  vManagedServerRequestMethod,
  vServerRequestId,
  type CodexHostComponentRefs,
  type CodexHostComponentsInput,
  type HostActorContext,
} from "./convexSlice.js";

export { hasRecoverableIngestErrors, type HostIngestErrorLike } from "./ingestRecovery.js";
export { resolveActorFromAuth } from "./authActor.js";
