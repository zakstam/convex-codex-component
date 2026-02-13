export const HOST_PRESET_DEFINITIONS = [
  {
    builder: "defineDispatchManagedHostEndpoints",
    profile: "dispatchManaged",
    ingestMode: "mixed",
    threadMode: "resolve",
    intendedHost: "Tauri / externally claimed dispatch",
  },
  {
    builder: "defineRuntimeOwnedHostEndpoints",
    profile: "runtimeOwned",
    ingestMode: "streamOnly",
    threadMode: "create",
    intendedHost: "Runtime-owned orchestration",
  },
] as const;

export const HOST_SURFACE_MANIFEST = {
  dispatchManaged: {
    mutations: [
      "ensureThread",
      "enqueueTurnDispatch",
      "claimNextTurnDispatch",
      "markTurnDispatchStarted",
      "markTurnDispatchCompleted",
      "markTurnDispatchFailed",
      "cancelTurnDispatch",
      "ensureSession",
      "ingestEvent",
      "ingestBatch",
      "respondApprovalForHooks",
      "upsertPendingServerRequestForHooks",
      "resolvePendingServerRequestForHooks",
      "upsertTokenUsageForHooks",
      "interruptTurnForHooks",
    ],
    queries: [
      "validateHostWiring",
      "getTurnDispatchState",
      "getDispatchObservability",
      "threadSnapshot",
      "threadSnapshotSafe",
      "persistenceStats",
      "durableHistoryStats",
      "listThreadMessagesForHooks",
      "listTurnMessagesForHooks",
      "listThreadReasoningForHooks",
      "listPendingApprovalsForHooks",
      "listPendingServerRequestsForHooks",
      "listTokenUsageForHooks",
    ],
  },
  runtimeOwned: {
    mutations: [
      "ensureThread",
      "enqueueTurnDispatch",
      "claimNextTurnDispatch",
      "markTurnDispatchStarted",
      "markTurnDispatchCompleted",
      "markTurnDispatchFailed",
      "cancelTurnDispatch",
      "ensureSession",
      "ingestEvent",
      "ingestBatch",
      "respondApprovalForHooks",
      "upsertTokenUsageForHooks",
      "interruptTurnForHooks",
    ],
    queries: [
      "validateHostWiring",
      "getTurnDispatchState",
      "getDispatchObservability",
      "threadSnapshot",
      "threadSnapshotSafe",
      "persistenceStats",
      "durableHistoryStats",
      "dataHygiene",
      "listThreadMessagesForHooks",
      "listTurnMessagesForHooks",
      "listPendingApprovalsForHooks",
      "listTokenUsageForHooks",
    ],
  },
} as const;

export type HostSurfaceProfile = keyof typeof HOST_SURFACE_MANIFEST;

export type HostSurfaceMutationKey<Profile extends HostSurfaceProfile> =
  (typeof HOST_SURFACE_MANIFEST)[Profile]["mutations"][number];

export type HostSurfaceQueryKey<Profile extends HostSurfaceProfile> =
  (typeof HOST_SURFACE_MANIFEST)[Profile]["queries"][number];
