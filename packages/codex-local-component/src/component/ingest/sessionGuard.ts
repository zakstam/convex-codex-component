import type { MutationCtx } from "../_generated/server.js";
import { authzError, now, requireThreadForActor } from "../utils.js";
import { syncError } from "../syncRuntime.js";
import type {
  EnsureSessionResult,
  HeartbeatArgs,
  IngestSafeErrorCode,
  IngestSession,
  PushEventsArgs,
} from "./types.js";

const RECOVERABLE_INGEST_CODES = new Set([
  "E_SYNC_SESSION_NOT_FOUND",
  "E_SYNC_SESSION_THREAD_MISMATCH",
  "E_SYNC_SESSION_DEVICE_MISMATCH",
]);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseSyncErrorCode(error: unknown): string | null {
  const message = getErrorMessage(error);
  const match = /^\[([A-Z0-9_]+)\]/.exec(message);
  return match?.[1] ?? null;
}

export function mapIngestSafeCode(rawCode: string | null): IngestSafeErrorCode {
  switch (rawCode) {
    case "E_SYNC_SESSION_NOT_FOUND":
      return "SESSION_NOT_FOUND";
    case "E_SYNC_SESSION_THREAD_MISMATCH":
      return "SESSION_THREAD_MISMATCH";
    case "E_SYNC_SESSION_DEVICE_MISMATCH":
      return "SESSION_DEVICE_MISMATCH";
    case "E_SYNC_OUT_OF_ORDER":
      return "OUT_OF_ORDER";
    case "E_SYNC_REPLAY_GAP":
      return "REPLAY_GAP";
    default:
      return "UNKNOWN";
  }
}

export function isRecoverableIngestErrorCode(rawCode: string | null): boolean {
  return rawCode ? RECOVERABLE_INGEST_CODES.has(rawCode) : false;
}

export function errorMessage(error: unknown): string {
  return getErrorMessage(error);
}

export async function requireBoundSession(
  ctx: MutationCtx,
  args: Pick<PushEventsArgs, "actor" | "sessionId" | "threadId">,
): Promise<IngestSession> {
  await requireThreadForActor(ctx, args.actor, args.threadId);

  const session = await ctx.db
    .query("codex_sessions")
    .withIndex("tenantId_sessionId", (q) =>
      q.eq("tenantId", args.actor.tenantId).eq("sessionId", args.sessionId),
    )
    .first();

  if (!session) {
    syncError("E_SYNC_SESSION_NOT_FOUND", `No active session found for sessionId=${args.sessionId}`);
  }
  if (session.threadId !== args.threadId) {
    syncError(
      "E_SYNC_SESSION_THREAD_MISMATCH",
      `Session threadId=${session.threadId} does not match request threadId=${args.threadId}`,
    );
  }
  if (session.deviceId !== args.actor.deviceId) {
    syncError(
      "E_SYNC_SESSION_DEVICE_MISMATCH",
      `Session deviceId=${session.deviceId} does not match actor deviceId=${args.actor.deviceId}`,
    );
  }
  if (session.userId !== args.actor.userId) {
    authzError(
      "E_AUTH_SESSION_FORBIDDEN",
      `User ${args.actor.userId} is not allowed to access session ${args.sessionId}`,
    );
  }

  return session;
}

export async function upsertSessionHeartbeat(
  ctx: MutationCtx,
  args: HeartbeatArgs,
): Promise<EnsureSessionResult> {
  await requireThreadForActor(ctx, args.actor, args.threadId);

  const session = await ctx.db
    .query("codex_sessions")
    .withIndex("tenantId_sessionId", (q) =>
      q.eq("tenantId", args.actor.tenantId).eq("sessionId", args.sessionId),
    )
    .first();

  if (!session) {
    await ctx.db.insert("codex_sessions", {
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      deviceId: args.actor.deviceId,
      threadId: args.threadId,
      sessionId: args.sessionId,
      status: "active",
      lastHeartbeatAt: now(),
      lastEventCursor: args.lastEventCursor,
      startedAt: now(),
    });
    return {
      sessionId: args.sessionId,
      threadId: args.threadId,
      status: "created",
    };
  }

  if (session.userId !== args.actor.userId) {
    authzError(
      "E_AUTH_SESSION_FORBIDDEN",
      `User ${args.actor.userId} is not allowed to access session ${args.sessionId}`,
    );
  }
  if (session.threadId !== args.threadId) {
    syncError(
      "E_SYNC_SESSION_THREAD_MISMATCH",
      `Session threadId=${session.threadId} does not match request threadId=${args.threadId}`,
    );
  }
  if (session.deviceId !== args.actor.deviceId) {
    syncError(
      "E_SYNC_SESSION_DEVICE_MISMATCH",
      `Session deviceId=${session.deviceId} does not match actor deviceId=${args.actor.deviceId}`,
    );
  }

  await ctx.db.patch(session._id, {
    status: "active",
    lastHeartbeatAt: now(),
    lastEventCursor: Math.max(args.lastEventCursor, session.lastEventCursor),
  });

  return {
    sessionId: args.sessionId,
    threadId: args.threadId,
    status: "active",
  };
}
