export const HOST_CONTRACT_ARTIFACT = {
  runtimeOwned: {
    mutations: [
      "syncOpenConversationBinding",
      "markConversationSyncProgress",
      "forceRebindConversationSync",
      "startConversationSyncSource",
      "appendConversationSyncSourceChunk",
      "sealConversationSyncSource",
      "cancelConversationSyncJob",
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
      "getConversationSyncJob",
      "listConversationSyncJobs",
      "listThreadsForConversation",
      "getDeletionStatus",
      "persistenceStats",
      "durableHistoryStats",
      "dataHygiene",
      "threadSnapshotByConversation",
      "listThreadMessagesByConversation",
      "listTurnMessagesByConversation",
      "listPendingApprovals",
      "listTokenUsageByConversation",
      "listPendingServerRequestsByConversation",
      "listThreadReasoningByConversation",
    ],
  },
} as const;

export type HostContractProfile = keyof typeof HOST_CONTRACT_ARTIFACT;
export type HostContractMutationKey<Profile extends HostContractProfile> =
  (typeof HOST_CONTRACT_ARTIFACT)[Profile]["mutations"][number];
export type HostContractQueryKey<Profile extends HostContractProfile> =
  (typeof HOST_CONTRACT_ARTIFACT)[Profile]["queries"][number];
