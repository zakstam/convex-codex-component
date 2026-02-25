import { now, requireStreamForActor, requireThreadRefForActor } from "../utils.js";
import type { MutationCtx } from "../_generated/server.js";
import type { ActorContext, CheckpointIngestContext } from "./types.js";
import { userScopeFromActor } from "../scope.js";

export async function applyStreamCheckpoints(ingest: CheckpointIngestContext): Promise<void> {
  const streamCheckpointRows = await ingest.ctx.db
    .query("codex_stream_checkpoints")
    .withIndex("userScope_threadId_streamId", (q) =>
      q
        .eq("userScope", userScopeFromActor(ingest.args.actor))
        .eq("threadId", ingest.args.threadId)
    )
    .take(2000);

  const existingCheckpointByStreamId = new Map(
    streamCheckpointRows.map((row) => [row.streamId, row]),
  );

  for (const [streamId, cursor] of ingest.streamState.streamCheckpointCursorByStreamId) {
    const stream = await requireStreamForActor(ingest.ctx, ingest.args.actor, streamId);
    if (String(stream.threadId) !== ingest.args.threadId) {
      throw new Error(`Stream ${streamId} is not bound to thread ${ingest.args.threadId}`);
    }
    const existing = existingCheckpointByStreamId.get(streamId);
    if (existing) {
      if (cursor > Number(existing.ackedCursor)) {
        await ingest.ctx.db.patch(existing._id, {
          threadRef: ingest.thread._id,
          streamRef: stream._id,
          ackedCursor: cursor,
          updatedAt: now(),
        });
      }
      continue;
    }

    await ingest.ctx.db.insert("codex_stream_checkpoints", {
      userScope: userScopeFromActor(ingest.args.actor),
      ...(ingest.args.actor.userId !== undefined ? { userId: ingest.args.actor.userId } : {}),
      threadId: ingest.args.threadId,
      threadRef: ingest.thread._id,
      streamId,
      streamRef: stream._id,
      ackedCursor: cursor,
      updatedAt: now(),
    });
  }
}

export async function upsertCheckpoint(
  ctx: MutationCtx,
  args: {
    actor: ActorContext;
    threadId: string;
    streamId: string;
    cursor: number;
  },
): Promise<{ ok: true }> {
  const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
  const stream = await requireStreamForActor(ctx, args.actor, args.streamId);
  if (String(stream.threadId) !== args.threadId) {
    throw new Error(`Stream ${args.streamId} is not bound to thread ${args.threadId}`);
  }

  const existing = await ctx.db
    .query("codex_stream_checkpoints")
    .withIndex("userScope_threadId_streamId", (q) =>
      q
        .eq("userScope", userScopeFromActor(args.actor))
        .eq("threadId", args.threadId)
        .eq("streamId", args.streamId),
    )
    .first();

  if (existing) {
    if (args.cursor > Number(existing.ackedCursor)) {
      await ctx.db.patch(existing._id, {
        threadRef,
        streamRef: stream._id,
        ackedCursor: args.cursor,
        updatedAt: now(),
      });
    }
    return { ok: true };
  }

  await ctx.db.insert("codex_stream_checkpoints", {
    userScope: userScopeFromActor(args.actor),
    ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
    threadId: args.threadId,
    threadRef,
    streamId: args.streamId,
    streamRef: stream._id,
    ackedCursor: Math.max(0, Math.floor(args.cursor)),
    updatedAt: now(),
  });
  return { ok: true };
}
