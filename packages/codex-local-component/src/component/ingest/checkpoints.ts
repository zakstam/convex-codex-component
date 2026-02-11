import { now, requireThreadForActor } from "../utils.js";
import type { MutationCtx } from "../_generated/server.js";
import type { ActorContext, IngestContext } from "./types.js";
import { userScopeFromActor } from "../scope.js";

export async function applyStreamCheckpoints(ingest: IngestContext): Promise<void> {
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
    const existing = existingCheckpointByStreamId.get(streamId);
    if (existing) {
      if (cursor > Number(existing.ackedCursor)) {
        await ingest.ctx.db.patch(existing._id, {
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
      streamId,
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
  await requireThreadForActor(ctx, args.actor, args.threadId);

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
    streamId: args.streamId,
    ackedCursor: Math.max(0, Math.floor(args.cursor)),
    updatedAt: now(),
  });
  return { ok: true };
}
