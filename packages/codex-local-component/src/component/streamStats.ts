import type { MutationCtx } from "./_generated/server.js";
import { now } from "./utils.js";

type StreamStateKind = "streaming" | "finished" | "aborted";

type EnsureStreamStatArgs = {
  tenantId: string;
  threadId: string;
  turnId: string;
  streamId: string;
  state: StreamStateKind;
};

type AddDeltaStatsArgs = {
  tenantId: string;
  threadId: string;
  turnId: string;
  streamId: string;
  deltaCount: number;
  latestCursor: number;
};

async function getByStreamId(
  ctx: MutationCtx,
  tenantId: string,
  streamId: string,
) {
  return ctx.db
    .query("codex_stream_stats")
    .withIndex("tenantId_streamId", (q) =>
      q.eq("tenantId", tenantId).eq("streamId", streamId),
    )
    .first();
}

export async function deleteStreamStat(
  ctx: MutationCtx,
  tenantId: string,
  streamId: string,
): Promise<void> {
  const existing = await getByStreamId(ctx, tenantId, streamId);
  if (!existing) {
    return;
  }
  await ctx.db.delete(existing._id);
}

export async function ensureStreamStat(
  ctx: MutationCtx,
  args: EnsureStreamStatArgs,
): Promise<void> {
  const existing = await getByStreamId(ctx, args.tenantId, args.streamId);
  const ts = now();
  if (!existing) {
    await ctx.db.insert("codex_stream_stats", {
      tenantId: args.tenantId,
      threadId: args.threadId,
      turnId: args.turnId,
      streamId: args.streamId,
      state: args.state,
      deltaCount: 0,
      latestCursor: 0,
      updatedAt: ts,
    });
    return;
  }

  if (
    existing.state !== args.state ||
    existing.threadId !== args.threadId ||
    existing.turnId !== args.turnId
  ) {
    await ctx.db.patch(existing._id, {
      threadId: args.threadId,
      turnId: args.turnId,
      state: args.state,
      updatedAt: ts,
    });
  }
}

export async function addStreamDeltaStats(
  ctx: MutationCtx,
  args: AddDeltaStatsArgs,
): Promise<void> {
  const existing = await getByStreamId(ctx, args.tenantId, args.streamId);
  const ts = now();
  if (!existing) {
    await ctx.db.insert("codex_stream_stats", {
      tenantId: args.tenantId,
      threadId: args.threadId,
      turnId: args.turnId,
      streamId: args.streamId,
      state: "streaming",
      deltaCount: args.deltaCount,
      latestCursor: args.latestCursor,
      updatedAt: ts,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    threadId: args.threadId,
    turnId: args.turnId,
    deltaCount: existing.deltaCount + args.deltaCount,
    latestCursor: Math.max(existing.latestCursor, args.latestCursor),
    updatedAt: ts,
  });
}

export async function addStreamDeltaStatsBatch(
  ctx: MutationCtx,
  args: {
    tenantId: string;
    threadId: string;
    updates: Array<{ streamId: string; turnId: string; deltaCount: number; latestCursor: number }>;
  },
): Promise<void> {
  if (args.updates.length === 0) {
    return;
  }

  const existingStats = await ctx.db
    .query("codex_stream_stats")
    .withIndex("tenantId_threadId", (q) =>
      q.eq("tenantId", args.tenantId).eq("threadId", args.threadId),
    )
    .take(500);
  const existingByStreamId = new Map(existingStats.map((stat) => [String(stat.streamId), stat]));
  const ts = now();

  await Promise.all(
    args.updates.map(async (update) => {
      const existing = existingByStreamId.get(update.streamId);
      if (!existing) {
        await ctx.db.insert("codex_stream_stats", {
          tenantId: args.tenantId,
          threadId: args.threadId,
          turnId: update.turnId,
          streamId: update.streamId,
          state: "streaming",
          deltaCount: update.deltaCount,
          latestCursor: update.latestCursor,
          updatedAt: ts,
        });
        return;
      }

      await ctx.db.patch(existing._id, {
        threadId: args.threadId,
        turnId: update.turnId,
        deltaCount: existing.deltaCount + update.deltaCount,
        latestCursor: Math.max(existing.latestCursor, update.latestCursor),
        updatedAt: ts,
      });
    }),
  );
}

export async function setStreamStatState(
  ctx: MutationCtx,
  args: EnsureStreamStatArgs,
): Promise<void> {
  await ensureStreamStat(ctx, args);
}
