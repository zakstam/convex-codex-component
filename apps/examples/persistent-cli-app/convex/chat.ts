import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  createCodexConvexHost,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

export const SERVER_ACTOR: HostActorContext = Object.freeze({
  ...(process.env.ACTOR_USER_ID ? { userId: process.env.ACTOR_USER_ID } : {}),
});

const codexHost = createCodexConvexHost({
  components,
  actorPolicy: {
    mode: "serverActor",
    serverActor: SERVER_ACTOR,
  },
});
const defs = codexHost.defs;

export const ensureThread = mutation(defs.mutations.ensureThread);
export const ensureSession = mutation(defs.mutations.ensureSession);
export const ingestEvent = mutation(defs.mutations.ingestEvent);
export const ingestBatch = mutation(defs.mutations.ingestBatch);
export const respondApprovalForHooks = mutation(defs.mutations.respondApprovalForHooks);
export const upsertTokenUsageForHooks = mutation(defs.mutations.upsertTokenUsageForHooks);
export const interruptTurnForHooks = mutation(defs.mutations.interruptTurnForHooks);

export const validateHostWiring = query(defs.queries.validateHostWiring);
export const threadSnapshot = query(defs.queries.threadSnapshot);
export const threadSnapshotSafe = query(defs.queries.threadSnapshotSafe);
export const persistenceStats = query(defs.queries.persistenceStats);
export const durableHistoryStats = query(defs.queries.durableHistoryStats);
export const dataHygiene = query(defs.queries.dataHygiene);
export const listThreadMessagesForHooks = query(defs.queries.listThreadMessagesForHooks);
export const listTurnMessagesForHooks = query(defs.queries.listTurnMessagesForHooks);
export const listPendingApprovalsForHooks = query(defs.queries.listPendingApprovalsForHooks);
export const listTokenUsageForHooks = query(defs.queries.listTokenUsageForHooks);
