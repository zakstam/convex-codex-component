import { resolveRuntimeOptions, syncError } from "../syncRuntime.js";
import type { MutationCtx } from "../_generated/server.js";
import { normalizeInboundEvents } from "./normalize.js";
import { createIngestStateCache } from "./stateCache.js";
import { requireBoundSession } from "./sessionGuard.js";
import type { IngestProgressState, PushEventsArgs } from "./types.js";
import { userScopeFromActor } from "../scope.js";
import { ensureTurnForEvent, collectTurnSignals, finalizeTurns } from "./applyTurns.js";
import { applyMessageEffectsForEvent } from "./applyMessages.js";
import { collectApprovalEffects, finalizeApprovals } from "./applyApprovals.js";
import {
  applyStreamEvent,
  flushStreamStats,
  persistLifecycleEventIfMissing,
} from "./applyStreams.js";
import { loadStreamStatsByStreamIds } from "../streamStats.js";
import { applyStreamCheckpoints } from "./checkpoints.js";
import { patchSessionAfterIngest, schedulePostIngestMaintenance } from "./postIngest.js";
import { requireThreadForActor } from "../utils.js";

export async function ingestEvents(
  ctx: MutationCtx,
  args: PushEventsArgs,
): Promise<{ ackedStreams: Array<{ streamId: string; ackCursorEnd: number }>; ingestStatus: "ok" | "partial" }> {
  const runtime = resolveRuntimeOptions(args.runtime);
  const deltas = normalizeInboundEvents({
    streamDeltas: [...args.streamDeltas, ...args.lifecycleEvents],
  });

  if (deltas.length === 0) {
    syncError("E_SYNC_EMPTY_BATCH", "ingest received an empty delta batch");
  }

  const thread = await requireThreadForActor(ctx, args.actor, args.threadId);
  const session = await requireBoundSession(ctx, args);

  const streamIdsInBatch = Array.from(
    new Set(
      deltas
        .filter((event): event is (typeof deltas)[number] & { type: "stream_delta" } => event.type === "stream_delta")
        .map((event) => event.streamId),
    ),
  );
  const streamStats = await loadStreamStatsByStreamIds(ctx, {
    userScope: userScopeFromActor(args.actor),
    streamIds: streamIdsInBatch,
  });

  const shared = {
    ctx,
    args,
    thread,
  };

  const collected = {
    inBatchEventIds: new Set<string>(),
    knownTurnIds: new Set<string>(),
    startedTurns: new Set<string>(),
    terminalTurns: new Map(),
    pendingApprovals: new Map(),
    resolvedApprovals: new Map(),
  };

  const streamState = {
    persistedStatsByStreamId: new Map(),
    streamCheckpointCursorByStreamId: new Map<string, number>(),
    expectedCursorByStreamId: new Map<string, number>(
      streamStats.map((stat) => [String(stat.streamId), Number(stat.latestCursor)]),
    ),
  };

  const progress: IngestProgressState = {
    lastPersistedCursor: session.lastEventCursor,
    persistedAnyEvent: false,
    ingestStatus: "ok",
  };

  const turnIngest = {
    ...shared,
    collected,
  };
  const messageIngest = {
    ...shared,
    runtime,
  };
  const approvalIngest = {
    ...shared,
    collected,
  };
  const streamIngest = {
    ...shared,
    runtime,
    collected,
    streamState,
    progress,
  };
  const checkpointIngest = {
    ...shared,
    streamState,
  };
  const sessionIngest = {
    ctx,
    args,
    session,
    progress,
  };

  const cache = createIngestStateCache({
    ctx,
    userScope: userScopeFromActor(args.actor),
    threadId: args.threadId,
  });
  for (const turnId of new Set(deltas.map((event) => event.turnId).filter((turnId): turnId is string => Boolean(turnId)))) {
    const turn = await cache.getTurnRecord(turnId);
    if (turn) {
      cache.setTurnRecord(turnId, turn);
      collected.knownTurnIds.add(turnId);
    }
  }

  for (const event of deltas) {
    await ensureTurnForEvent(turnIngest, event, cache);
    collectTurnSignals(turnIngest, event);
    collectApprovalEffects(approvalIngest, event);
    await applyMessageEffectsForEvent(messageIngest, event, cache);

    if (event.type === "lifecycle_event") {
      await persistLifecycleEventIfMissing(streamIngest, event, cache);
      continue;
    }

    await applyStreamEvent(streamIngest, event, cache);
  }

  await cache.flushMessagePatches();
  await finalizeTurns(turnIngest, cache);
  await finalizeApprovals(approvalIngest, cache);
  await flushStreamStats(streamIngest);
  await applyStreamCheckpoints(checkpointIngest);

  const nowMs = await patchSessionAfterIngest(sessionIngest);
  await schedulePostIngestMaintenance(sessionIngest, nowMs);

  const ackedStreams = Array.from(streamState.streamCheckpointCursorByStreamId.entries())
    .map(([streamId, ackCursorEnd]) => ({ streamId, ackCursorEnd }))
    .sort((a, b) => a.streamId.localeCompare(b.streamId));

  return { ackedStreams, ingestStatus: progress.ingestStatus };
}
