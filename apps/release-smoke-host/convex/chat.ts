import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  createCodexHost,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

export const SERVER_ACTOR: HostActorContext = Object.freeze({
  ...(process.env.ACTOR_USER_ID ? { userId: process.env.ACTOR_USER_ID } : {}),
});

const codex = createCodexHost({
  components,
  mutation,
  query,
  actorPolicy: {
    mode: "serverActor",
    serverActor: SERVER_ACTOR,
  },
});

export const { ensureThread, ensureSession, ingestEvent, ingestBatch,
  respondApproval, upsertTokenUsage, interruptTurn } = codex.mutations;

export const { validateHostWiring, threadSnapshot, threadSnapshotSafe,
  persistenceStats, durableHistoryStats, dataHygiene,
  listThreadMessages, listTurnMessages, listPendingApprovals,
  listTokenUsage } = codex.queries;
