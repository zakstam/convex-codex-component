import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { defineCodexHostDefinitions } from "@zakstam/codex-local-component/host/convex";

export { getActorBindingForBootstrap, listThreadsForPicker, resolveThreadHandleForStart } from "./chat.extensions";

const codex = defineCodexHostDefinitions({ components });

export const ensureThread = mutation(codex.mutations.ensureThread);
export const ensureSession = mutation(codex.mutations.ensureSession);
export const ingestEvent = mutation(codex.mutations.ingestEvent);
export const ingestBatch = mutation(codex.mutations.ingestBatch);
export const deleteThread = mutation(codex.mutations.deleteThread);
export const scheduleDeleteThread = mutation(codex.mutations.scheduleDeleteThread);
export const deleteTurn = mutation(codex.mutations.deleteTurn);
export const scheduleDeleteTurn = mutation(codex.mutations.scheduleDeleteTurn);
export const purgeActorData = mutation(codex.mutations.purgeActorData);
export const schedulePurgeActorData = mutation(codex.mutations.schedulePurgeActorData);
export const cancelDeletion = mutation(codex.mutations.cancelDeletion);
export const forceRunDeletion = mutation(codex.mutations.forceRunDeletion);
export const respondApproval = mutation(codex.mutations.respondApproval);
export const upsertTokenUsage = mutation(codex.mutations.upsertTokenUsage);
export const interruptTurn = mutation(codex.mutations.interruptTurn);
export const upsertPendingServerRequest = mutation(codex.mutations.upsertPendingServerRequest);
export const resolvePendingServerRequest = mutation(codex.mutations.resolvePendingServerRequest);
export const acceptTurnSend = mutation(codex.mutations.acceptTurnSend);
export const failAcceptedTurnSend = mutation(codex.mutations.failAcceptedTurnSend);

export const validateHostWiring = query(codex.queries.validateHostWiring);
export const threadSnapshot = query(codex.queries.threadSnapshot);
export const getDeletionStatus = query(codex.queries.getDeletionStatus);
export const persistenceStats = query(codex.queries.persistenceStats);
export const durableHistoryStats = query(codex.queries.durableHistoryStats);
export const dataHygiene = query(codex.queries.dataHygiene);
export const listThreadMessages = query(codex.queries.listThreadMessages);
export const listTurnMessages = query(codex.queries.listTurnMessages);
export const listPendingApprovals = query(codex.queries.listPendingApprovals);
export const listTokenUsage = query(codex.queries.listTokenUsage);
export const listPendingServerRequests = query(codex.queries.listPendingServerRequests);
export const listThreadReasoning = query(codex.queries.listThreadReasoning);
