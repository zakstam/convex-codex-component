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

export const { ensureThread, ensureSession, ingestEvent, ingestBatch,
  respondApproval, upsertTokenUsage, interruptTurn,
  validateHostWiring, threadSnapshot, threadSnapshotSafe,
  persistenceStats, durableHistoryStats, dataHygiene,
  listThreadMessages, listTurnMessages, listPendingApprovals,
  listTokenUsage } = codex.endpoints;
