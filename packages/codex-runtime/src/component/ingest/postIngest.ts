import {
  CLEANUP_SWEEP_MIN_INTERVAL_MS,
  HEARTBEAT_WRITE_MIN_INTERVAL_MS,
  STALE_SWEEP_MIN_INTERVAL_MS,
} from "../syncRuntime.js";
import { internal } from "../_generated/api.js";
import { now } from "../utils.js";
import type { SessionIngestContext } from "./types.js";
import { userScopeFromActor } from "../scope.js";

export async function patchSessionAfterIngest(ingest: SessionIngestContext): Promise<number> {
  const sessionPatch: {
    status: "active";
    lastHeartbeatAt?: number;
    lastEventCursor?: number;
  } = { status: "active" };

  const nextLastEventCursor = Math.max(ingest.session.lastEventCursor, ingest.progress.lastPersistedCursor);
  if (nextLastEventCursor !== ingest.session.lastEventCursor) {
    sessionPatch.lastEventCursor = nextLastEventCursor;
  }

  const nowMs = now();
  if (ingest.progress.persistedAnyEvent || nowMs - ingest.session.lastHeartbeatAt >= HEARTBEAT_WRITE_MIN_INTERVAL_MS) {
    sessionPatch.lastHeartbeatAt = nowMs;
  }

  await ingest.ctx.db.patch(ingest.session._id, sessionPatch);
  return nowMs;
}

export async function schedulePostIngestMaintenance(
  ingest: SessionIngestContext,
  nowMs: number,
): Promise<void> {
  if (nowMs - ingest.session.lastHeartbeatAt >= STALE_SWEEP_MIN_INTERVAL_MS) {
    await ingest.ctx.scheduler.runAfter(
      0,
      internal.sessions.timeoutStaleSessions,
      {
        userScope: userScopeFromActor(ingest.args.actor),
        staleBeforeMs: nowMs - 1000 * 60 * 3,
      },
    );
  }

  if (ingest.progress.persistedAnyEvent && nowMs - ingest.session.lastHeartbeatAt >= CLEANUP_SWEEP_MIN_INTERVAL_MS) {
    await ingest.ctx.scheduler.runAfter(
      0,
      internal.streams.cleanupExpiredDeltas,
      {
        nowMs,
        batchSize: 1000,
      },
    );
  }
}
