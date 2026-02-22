import {
  HOST_CONTRACT_ARTIFACT,
  type HostContractMutationKey,
  type HostContractProfile,
  type HostContractQueryKey,
} from "../contractArtifact.js";

export const HOST_SURFACE_MANIFEST = HOST_CONTRACT_ARTIFACT;

export type HostSurfaceProfile = HostContractProfile;

export type HostSurfaceMutationKey<Profile extends HostSurfaceProfile> =
  HostContractMutationKey<Profile>;

export type HostSurfaceQueryKey<Profile extends HostSurfaceProfile> =
  HostContractQueryKey<Profile>;

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
  listPendingApprovalsForHooks: "listPendingApprovals",
  listThreadReasoningForHooks: "listThreadReasoningByConversation",
} as const;
