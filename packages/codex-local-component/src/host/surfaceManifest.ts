export const HOST_SURFACE_MANIFEST = {
  runtimeOwned: {
    mutations: [
      "syncOpenConversationBinding",
      "markConversationSyncProgress",
      "forceRebindConversationSync",
      "ensureConversationBinding",
      "archiveConversation",
      "unarchiveConversation",
      "ensureSession",
      "ingestEvent",
      "ingestBatch",
      "deleteThread",
      "scheduleDeleteThread",
      "deleteTurn",
      "scheduleDeleteTurn",
      "purgeActorData",
      "schedulePurgeActorData",
      "cancelDeletion",
      "forceRunDeletion",
      "respondApproval",
      "upsertTokenUsage",
      "interruptTurn",
      "upsertPendingServerRequest",
      "resolvePendingServerRequest",
      "acceptTurnSend",
      "failAcceptedTurnSend",
    ],
    queries: [
      "validateHostWiring",
      "threadSnapshot",
      "listThreadsForConversation",
      "getDeletionStatus",
      "persistenceStats",
      "durableHistoryStats",
      "dataHygiene",
      "listThreadMessages",
      "threadSnapshotByConversation",
      "listThreadMessagesByConversation",
      "listTurnMessages",
      "listTurnMessagesByConversation",
      "listPendingApprovals",
      "listTokenUsage",
      "listTokenUsageByConversation",
      "listPendingServerRequestsByConversation",
      "listPendingServerRequests",
      "listThreadReasoning",
    ],
  },
} as const;

export type HostSurfaceProfile = keyof typeof HOST_SURFACE_MANIFEST;

export type HostSurfaceMutationKey<Profile extends HostSurfaceProfile> =
  (typeof HOST_SURFACE_MANIFEST)[Profile]["mutations"][number];

export type HostSurfaceQueryKey<Profile extends HostSurfaceProfile> =
  (typeof HOST_SURFACE_MANIFEST)[Profile]["queries"][number];

/**
 * Maps internal defineCodexHostSlice mutation keys to clean public names.
 */
export const HOST_MUTATION_INTERNAL_ALIASES = {
  respondApprovalForHooks: "respondApproval",
  upsertTokenUsageForHooks: "upsertTokenUsage",
  interruptTurnForHooks: "interruptTurn",
  upsertPendingServerRequestForHooks: "upsertPendingServerRequest",
  resolvePendingServerRequestForHooks: "resolvePendingServerRequest",
  acceptTurnSendForHooks: "acceptTurnSend",
  failAcceptedTurnSendForHooks: "failAcceptedTurnSend",
} as const;

/**
 * Maps internal defineCodexHostSlice query keys to clean public names.
 */
export const HOST_QUERY_INTERNAL_ALIASES = {
  listThreadMessagesForHooks: "listThreadMessages",
  listTurnMessagesForHooks: "listTurnMessages",
  listPendingApprovalsForHooks: "listPendingApprovals",
  listTokenUsageForHooks: "listTokenUsage",
  listPendingServerRequestsForHooks: "listPendingServerRequests",
  listThreadReasoningForHooks: "listThreadReasoning",
} as const;
