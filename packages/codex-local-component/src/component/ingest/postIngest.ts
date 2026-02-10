import { makeFunctionReference } from "convex/server";
import {
  CLEANUP_SWEEP_MIN_INTERVAL_MS,
  HEARTBEAT_WRITE_MIN_INTERVAL_MS,
  STALE_SWEEP_MIN_INTERVAL_MS,
} from "../syncRuntime.js";
import { now } from "../utils.js";
import type { IngestContext } from "./types.js";

export async function patchSessionAfterIngest(ingest: IngestContext): Promise<number> {
  const sessionPatch: {
    status: "active";
    lastHeartbeatAt?: number;
    lastEventCursor?: number;
  } = { status: "active" };

  const nextLastEventCursor = Math.max(ingest.session.lastEventCursor, ingest.lastPersistedCursor);
  if (nextLastEventCursor !== ingest.session.lastEventCursor) {
    sessionPatch.lastEventCursor = nextLastEventCursor;
  }

  const nowMs = now();
  if (ingest.persistedAnyEvent || nowMs - ingest.session.lastHeartbeatAt >= HEARTBEAT_WRITE_MIN_INTERVAL_MS) {
    sessionPatch.lastHeartbeatAt = nowMs;
  }

  await ingest.ctx.db.patch(ingest.session._id, sessionPatch);
  return nowMs;
}

export async function schedulePostIngestMaintenance(
  ingest: IngestContext,
  nowMs: number,
): Promise<void> {
  if (nowMs - ingest.session.lastHeartbeatAt >= STALE_SWEEP_MIN_INTERVAL_MS) {
    await ingest.ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("sessions:timeoutStaleSessions"),
      {
        tenantId: ingest.args.actor.tenantId,
        staleBeforeMs: nowMs - 1000 * 60 * 3,
      },
    );
  }

  if (ingest.persistedAnyEvent && nowMs - ingest.session.lastHeartbeatAt >= CLEANUP_SWEEP_MIN_INTERVAL_MS) {
    await ingest.ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("streams:cleanupExpiredDeltas"),
      {
        nowMs,
        batchSize: 1000,
      },
    );
  }
}
