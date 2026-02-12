import { resolveRuntimeOptions, syncError } from "../syncRuntime.js";
import type { MutationCtx } from "../_generated/server.js";
import { normalizeInboundEvents } from "./normalize.js";
import { createIngestStateCache } from "./stateCache.js";
import { requireBoundSession } from "./sessionGuard.js";
import type { PushEventsArgs } from "./types.js";
import { userScopeFromActor } from "../scope.js";
import { ensureTurnForEvent, collectTurnSignals, finalizeTurns } from "./applyTurns.js";
import { applyMessageEffectsForEvent } from "./applyMessages.js";
import { collectApprovalEffects, finalizeApprovals } from "./applyApprovals.js";
import {
  applyStreamEvent,
  flushStreamStats,
  persistLifecycleEventIfMissing,
} from "./applyStreams.js";
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

  const streamStats = await ctx.db
    .query("codex_stream_stats")
    .withIndex("userScope_threadId", (q) =>
      q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
    )
    .take(500);

  const ingest = {
    ctx,
    args,
    runtime,
    thread,
    session,
    collected: {
      inBatchEventIds: new Set<string>(),
      knownTurnIds: new Set<string>(),
      startedTurns: new Set<string>(),
      terminalTurns: new Map(),
      pendingApprovals: new Map(),
      resolvedApprovals: new Map(),
    },
    streamState: {
      persistedStatsByStreamId: new Map(),
      streamCheckpointCursorByStreamId: new Map<string, number>(),
      expectedCursorByStreamId: new Map<string, number>(
        streamStats.map((stat) => [String(stat.streamId), Number(stat.latestCursor)]),
      ),
    },
    lastPersistedCursor: session.lastEventCursor,
    persistedAnyEvent: false,
    ingestStatus: "ok" as const,
  };

  const cache = createIngestStateCache({
    ctx,
    userScope: userScopeFromActor(args.actor),
    threadId: args.threadId,
  });

  for (const event of deltas) {
    await ensureTurnForEvent(ingest, event);
    collectTurnSignals(ingest, event);
    collectApprovalEffects(ingest, event);
    await applyMessageEffectsForEvent(ingest, event, cache);

    if (event.type === "lifecycle_event") {
      await persistLifecycleEventIfMissing(ingest, event);
      continue;
    }

    await applyStreamEvent(ingest, event, cache);
  }

  await cache.flushMessagePatches();
  await finalizeTurns(ingest);
  await finalizeApprovals(ingest, cache);
  await flushStreamStats(ingest);
  await applyStreamCheckpoints(ingest);

  const nowMs = await patchSessionAfterIngest(ingest);
  await schedulePostIngestMaintenance(ingest, nowMs);

  const ackedStreams = Array.from(ingest.streamState.streamCheckpointCursorByStreamId.entries())
    .map(([streamId, ackCursorEnd]) => ({ streamId, ackCursorEnd }))
    .sort((a, b) => a.streamId.localeCompare(b.streamId));

  return { ackedStreams, ingestStatus: ingest.ingestStatus };
}
