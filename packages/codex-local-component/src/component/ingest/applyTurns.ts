import { internal } from "../_generated/api.js";
import { pickHigherPriorityTerminalStatus } from "../syncHelpers.js";
import { authzError, now } from "../utils.js";
import type { NormalizedInboundEvent, TurnIngestContext } from "./types.js";
import { userScopeFromActor } from "../scope.js";
import type { IngestStateCache } from "./stateCache.js";

export async function ensureTurnForEvent(
  ingest: TurnIngestContext,
  event: NormalizedInboundEvent,
  cache: IngestStateCache,
): Promise<void> {
  const turnId = event.turnId;
  if (!turnId || ingest.collected.knownTurnIds.has(turnId)) {
    return;
  }

  const existingTurn = await cache.getTurnRecord(turnId);

  if (!existingTurn) {
    const createdTurnId = await ingest.ctx.db.insert("codex_turns", {
      userScope: userScopeFromActor(ingest.args.actor),
      ...(ingest.args.actor.userId !== undefined ? { userId: ingest.args.actor.userId } : {}),
      threadId: ingest.args.threadId,
      threadRef: ingest.thread._id,
      turnId,
      status: event.syntheticTurnStatus,
      idempotencyKey: `sync:${ingest.args.threadId}:${turnId}`,
      startedAt: now(),
      ...(event.syntheticTurnStatus === "completed" ||
      event.syntheticTurnStatus === "interrupted" ||
      event.syntheticTurnStatus === "failed"
        ? { completedAt: now() }
        : {}),
    });
    const createdTurn = await ingest.ctx.db.get(createdTurnId);
    if (createdTurn) {
      cache.setTurnRecord(turnId, createdTurn);
    }
  } else if (existingTurn.userId !== ingest.args.actor.userId) {
    authzError(
      "E_AUTH_TURN_FORBIDDEN",
      `User ${ingest.args.actor.userId} is not allowed to access turn ${turnId}`,
    );
  }

  ingest.collected.knownTurnIds.add(turnId);
}

export function collectTurnSignals(ingest: TurnIngestContext, event: NormalizedInboundEvent): void {
  if (!event.turnId) {
    return;
  }

  if (event.kind === "turn/started") {
    ingest.collected.startedTurns.add(event.turnId);
  }

  if (event.terminalTurnStatus) {
    const current = ingest.collected.terminalTurns.get(event.turnId);
    ingest.collected.terminalTurns.set(
      event.turnId,
      pickHigherPriorityTerminalStatus(current, event.terminalTurnStatus),
    );
  }
}

export async function finalizeTurns(
  ingest: TurnIngestContext,
  cache: IngestStateCache,
): Promise<void> {
  for (const turnId of ingest.collected.startedTurns) {
    const turn = await cache.getTurnRecord(turnId);
    if (!turn) {
      continue;
    }
    if (turn.status === "queued") {
      await ingest.ctx.db.patch(turn._id, { status: "inProgress" });
    }
  }

  for (const [turnId, terminal] of ingest.collected.terminalTurns) {
    await ingest.ctx.scheduler.runAfter(
      0,
      internal.turnsInternal.reconcileTerminalArtifacts,
      {
        userScope: userScopeFromActor(ingest.args.actor),
        threadId: ingest.args.threadId,
        turnId,
        status: terminal.status,
        ...(terminal.status !== "completed" ? { error: terminal.error } : {}),
      },
    );
  }
}
