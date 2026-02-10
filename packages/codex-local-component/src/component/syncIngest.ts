import type { MutationCtx } from "./_generated/server.js";
import { ingestEvents } from "./ingest/index.js";
import { upsertCheckpoint } from "./ingest/checkpoints.js";
import {
  errorMessage,
  isRecoverableIngestErrorCode,
  mapIngestSafeCode,
  parseSyncErrorCode,
  upsertSessionHeartbeat,
} from "./ingest/sessionGuard.js";
import type {
  EnsureSessionArgs,
  EnsureSessionResult,
  HeartbeatArgs,
  IngestSafeArgs,
  IngestSafeResult,
  PushEventsArgs,
} from "./ingest/types.js";

export type {
  InboundEvent,
  LifecycleInboundEvent,
  StreamInboundEvent,
} from "./ingest/types.js";

export async function ingestHandler(
  ctx: MutationCtx,
  args: PushEventsArgs,
): Promise<{
  ackedStreams: Array<{ streamId: string; ackCursorEnd: number }>;
  ingestStatus: "ok" | "partial";
}> {
  return ingestEvents(ctx, args);
}

export async function upsertCheckpointHandler(
  ctx: MutationCtx,
  args: {
    actor: { tenantId: string; userId: string; deviceId: string };
    threadId: string;
    streamId: string;
    cursor: number;
  },
): Promise<{ ok: true }> {
  return upsertCheckpoint(ctx, args);
}

export async function ensureSessionHandler(
  ctx: MutationCtx,
  args: EnsureSessionArgs,
): Promise<EnsureSessionResult> {
  return upsertSessionHeartbeat(ctx, args);
}

export async function heartbeatHandler(
  ctx: MutationCtx,
  args: HeartbeatArgs,
): Promise<null> {
  await upsertSessionHeartbeat(ctx, args);
  return null;
}

export async function ingestSafeHandler(
  ctx: MutationCtx,
  args: IngestSafeArgs,
): Promise<IngestSafeResult> {
  const ensureCursor = Math.max(0, Math.floor(args.ensureLastEventCursor ?? 0));

  try {
    const first = await ingestHandler(ctx, args);
    return {
      status: first.ingestStatus === "ok" ? "ok" : "partial",
      ingestStatus: first.ingestStatus,
      ackedStreams: first.ackedStreams,
      errors: [],
    };
  } catch (initialError) {
    const initialCode = parseSyncErrorCode(initialError);
    const initialMessage = errorMessage(initialError);

    if (!isRecoverableIngestErrorCode(initialCode)) {
      return {
        status: "rejected",
        ingestStatus: "partial",
        ackedStreams: [],
        errors: [
          {
            code: mapIngestSafeCode(initialCode),
            message: initialMessage,
            recoverable: false,
          },
        ],
      };
    }

    await upsertSessionHeartbeat(ctx, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      lastEventCursor: ensureCursor,
    });

    try {
      const retried = await ingestHandler(ctx, args);
      return {
        status: "session_recovered",
        ingestStatus: retried.ingestStatus,
        ackedStreams: retried.ackedStreams,
        recovery: {
          action: "session_rebound",
          sessionId: args.sessionId,
          threadId: args.threadId,
        },
        errors: [],
      };
    } catch (retryError) {
      const retryCode = parseSyncErrorCode(retryError);
      return {
        status: "rejected",
        ingestStatus: "partial",
        ackedStreams: [],
        errors: [
          {
            code: mapIngestSafeCode(retryCode),
            message: errorMessage(retryError),
            recoverable: isRecoverableIngestErrorCode(retryCode),
          },
        ],
      };
    }
  }
}
