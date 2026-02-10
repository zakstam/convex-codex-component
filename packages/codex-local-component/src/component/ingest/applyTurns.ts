import { makeFunctionReference } from "convex/server";
import { pickHigherPriorityTerminalStatus } from "../syncHelpers.js";
import { authzError, now, requireTurnForActor } from "../utils.js";
import type { IngestContext, NormalizedInboundEvent } from "./types.js";
import type { IngestStateCache } from "./stateCache.js";

export async function ensureTurnForEvent(
  ingest: IngestContext,
  event: NormalizedInboundEvent,
): Promise<void> {
  const turnId = event.turnId;
  if (!turnId || ingest.collected.knownTurnIds.has(turnId)) {
    return;
  }

  const existingTurn = await ingest.ctx.db
    .query("codex_turns")
    .withIndex("tenantId_threadId_turnId", (q) =>
      q
        .eq("tenantId", ingest.args.actor.tenantId)
        .eq("threadId", ingest.args.threadId)
        .eq("turnId", turnId),
    )
    .first();

  if (!existingTurn) {
    await ingest.ctx.db.insert("codex_turns", {
      tenantId: ingest.args.actor.tenantId,
      userId: ingest.args.actor.userId,
      threadId: ingest.args.threadId,
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
  } else if (existingTurn.userId !== ingest.args.actor.userId) {
    authzError(
      "E_AUTH_TURN_FORBIDDEN",
      `User ${ingest.args.actor.userId} is not allowed to access turn ${turnId}`,
    );
  }

  ingest.collected.knownTurnIds.add(turnId);
}

export function collectTurnSignals(ingest: IngestContext, event: NormalizedInboundEvent): void {
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

    if (event.type === "stream_delta") {
      const currentStream = ingest.collected.terminalByStream.get(event.streamId);
      ingest.collected.terminalByStream.set(
        event.streamId,
        pickHigherPriorityTerminalStatus(currentStream, event.terminalTurnStatus),
      );
    }
  }
}

export async function finalizeTurns(
  ingest: IngestContext,
  cache: IngestStateCache,
): Promise<void> {
  for (const turnId of ingest.collected.startedTurns) {
    const turn = await requireTurnForActor(ingest.ctx, ingest.args.actor, ingest.args.threadId, turnId);
    if (turn.status === "queued") {
      await ingest.ctx.db.patch(turn._id, { status: "inProgress" });
    }
  }

  for (const [turnId, terminal] of ingest.collected.terminalTurns) {
    await ingest.ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("turnsInternal:finalizeTurnFromStream"),
      {
        tenantId: ingest.args.actor.tenantId,
        threadId: ingest.args.threadId,
        turnId,
        status: terminal.status,
        ...(terminal.error ? { error: terminal.error } : {}),
      },
    );

    if (terminal.status !== "failed" && terminal.status !== "interrupted") {
      continue;
    }

    const pendingMessages = await ingest.ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_turnId_status", (q) =>
        q
          .eq("tenantId", ingest.args.actor.tenantId)
          .eq("threadId", ingest.args.threadId)
          .eq("turnId", turnId)
          .eq("status", "streaming"),
      )
      .take(500);

    await Promise.all(
      pendingMessages.map((message) =>
        ingest.ctx.db.patch(message._id, {
          status: terminal.status,
          ...(terminal.error ? { error: terminal.error } : {}),
          updatedAt: now(),
          completedAt: now(),
        }),
      ),
    );

    for (const message of pendingMessages) {
      cache.setMessageRecord(turnId, message.messageId, {
        _id: message._id,
        status: terminal.status,
        text: message.text,
      });
    }
  }
}
