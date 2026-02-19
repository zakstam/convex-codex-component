import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { createCodexHost } from "@zakstam/codex-local-component/host/convex";

const codex = createCodexHost({
  components,
  mutation,
  query,
  actorPolicy: {
    userId: process.env.ACTOR_USER_ID ?? "server",
  },
});

export const ensureThread = codex.endpoints.ensureThread;
export const ensureSession = codex.endpoints.ensureSession;
export const ingestEvent = codex.endpoints.ingestEvent;
export const ingestBatch = codex.endpoints.ingestBatch;
export const respondApproval = codex.endpoints.respondApproval;
export const upsertTokenUsage = codex.endpoints.upsertTokenUsage;
export const interruptTurn = codex.endpoints.interruptTurn;
export const validateHostWiring = codex.endpoints.validateHostWiring;
export const threadSnapshot = codex.endpoints.threadSnapshot;
export const threadSnapshotSafe = codex.endpoints.threadSnapshotSafe;
export const persistenceStats = codex.endpoints.persistenceStats;
export const durableHistoryStats = codex.endpoints.durableHistoryStats;
export const dataHygiene = codex.endpoints.dataHygiene;
export const listThreadMessages = codex.endpoints.listThreadMessages;
export const listTurnMessages = codex.endpoints.listTurnMessages;
export const listPendingApprovals = codex.endpoints.listPendingApprovals;
export const listTokenUsage = codex.endpoints.listTokenUsage;
