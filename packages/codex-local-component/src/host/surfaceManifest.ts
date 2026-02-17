export const HOST_PRESET_DEFINITIONS = [
  {
    builder: "createCodexConvexHost",
    profile: "runtimeOwned",
    ingestMode: "streamOnly",
    intendedHost: "Runtime-owned orchestration",
  },
] as const;

export const HOST_SURFACE_MANIFEST = {
  runtimeOwned: {
    mutations: [
      "ensureThread",
      "ensureSession",
      "ingestEvent",
      "ingestBatch",
      "respondApprovalForHooks",
      "upsertTokenUsageForHooks",
      "interruptTurnForHooks",
    ],
    queries: [
      "validateHostWiring",
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
