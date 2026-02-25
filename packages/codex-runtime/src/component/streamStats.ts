import type { MutationCtx } from "./_generated/server.js";
import { now } from "./utils.js";

type StreamStateKind = "streaming" | "finished" | "aborted";

type EnsureStreamStatArgs = {
  userScope: string;
  threadId: string;
  turnId: string;
  streamId: string;
  state: StreamStateKind;
};

type AddDeltaStatsArgs = {
  userScope: string;
  threadId: string;
  turnId: string;
  streamId: string;
  deltaCount: number;
  latestCursor: number;
};

const STREAM_STATE_RANK: Record<StreamStateKind, number> = {
  streaming: 0,
  finished: 1,
  aborted: 1,
};

function resolveMonotonicState(current: StreamStateKind, next: StreamStateKind): StreamStateKind {
  return STREAM_STATE_RANK[next] >= STREAM_STATE_RANK[current] ? next : current;
}

async function getByStreamId(
  ctx: MutationCtx,
  userScope: string,
  streamId: string,
) {
  return ctx.db
    .query("codex_stream_stats")
    .withIndex("userScope_streamId", (q) =>
      q.eq("userScope", userScope).eq("streamId", streamId),
    )
    .first();
}

async function requireStreamRecord(args: {
  ctx: MutationCtx;
  userScope: string;
  streamId: string;
}) {
  const stream = await args.ctx.db
    .query("codex_streams")
    .withIndex("userScope_streamId", (q) =>
      q.eq("userScope", args.userScope).eq("streamId", args.streamId),
    )
    .first();
  if (!stream) {
    throw new Error(`Stream not found: ${args.streamId}`);
  }
  return stream;
}

export async function deleteStreamStat(
  ctx: MutationCtx,
  userScope: string,
  streamId: string,
): Promise<void> {
  const existing = await getByStreamId(ctx, userScope, streamId);
  if (!existing) {
    return;
  }
  await ctx.db.delete(existing._id);
}

export async function ensureStreamStat(
  ctx: MutationCtx,
  args: EnsureStreamStatArgs,
): Promise<void> {
  const existing = await getByStreamId(ctx, args.userScope, args.streamId);
  const ts = now();
  if (!existing) {
    const stream = await requireStreamRecord({
      ctx,
      userScope: args.userScope,
      streamId: args.streamId,
    });
    await ctx.db.insert("codex_stream_stats", {
      userScope: args.userScope,
      threadId: args.threadId,
      turnId: args.turnId,
      streamId: args.streamId,
      streamRef: stream._id,
      state: args.state,
      deltaCount: 0,
      latestCursor: 0,
      updatedAt: ts,
    });
    return;
  }

  const nextState = resolveMonotonicState(existing.state, args.state);
  if (
    existing.state !== nextState ||
    existing.threadId !== args.threadId ||
    existing.turnId !== args.turnId
  ) {
    await ctx.db.patch(existing._id, {
      threadId: args.threadId,
      turnId: args.turnId,
      state: nextState,
      updatedAt: ts,
    });
  }
}

export async function addStreamDeltaStats(
  ctx: MutationCtx,
  args: AddDeltaStatsArgs,
): Promise<void> {
  const existing = await getByStreamId(ctx, args.userScope, args.streamId);
  const ts = now();
  if (!existing) {
    const stream = await requireStreamRecord({
      ctx,
      userScope: args.userScope,
      streamId: args.streamId,
    });
    await ctx.db.insert("codex_stream_stats", {
      userScope: args.userScope,
      threadId: args.threadId,
      turnId: args.turnId,
      streamId: args.streamId,
      streamRef: stream._id,
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
    state: resolveMonotonicState(existing.state, "streaming"),
    deltaCount: existing.deltaCount + args.deltaCount,
    latestCursor: Math.max(existing.latestCursor, args.latestCursor),
    updatedAt: ts,
  });
}

export async function addStreamDeltaStatsBatch(
  ctx: MutationCtx,
  args: {
    userScope: string;
    threadId: string;
    updates: Array<{ streamId: string; turnId: string; deltaCount: number; latestCursor: number }>;
  },
): Promise<void> {
  if (args.updates.length === 0) {
    return;
  }

  const existingByStreamId = new Map<string, NonNullable<Awaited<ReturnType<typeof getByStreamId>>>>();
  for (const streamId of Array.from(new Set(args.updates.map((update) => update.streamId)))) {
    const existing = await getByStreamId(ctx, args.userScope, streamId);
    if (existing) {
      existingByStreamId.set(streamId, existing);
    }
  }
  const ts = now();

  await Promise.all(
    args.updates.map(async (update) => {
      const existing = existingByStreamId.get(update.streamId);
      if (!existing) {
        const stream = await requireStreamRecord({
          ctx,
          userScope: args.userScope,
          streamId: update.streamId,
        });
        await ctx.db.insert("codex_stream_stats", {
          userScope: args.userScope,
          threadId: args.threadId,
          turnId: update.turnId,
          streamId: update.streamId,
          streamRef: stream._id,
          state: "streaming",
          deltaCount: update.deltaCount,
          latestCursor: update.latestCursor,
          updatedAt: ts,
        });
        return;
      }

      const nextDeltaCount = existing.deltaCount + update.deltaCount;
      const nextLatestCursor = Math.max(existing.latestCursor, update.latestCursor);
      const nextState = resolveMonotonicState(existing.state, "streaming");
      if (
        existing.threadId === args.threadId &&
        existing.turnId === update.turnId &&
        existing.state === nextState &&
        existing.deltaCount === nextDeltaCount &&
        existing.latestCursor === nextLatestCursor
      ) {
        return;
      }
      await ctx.db.patch(existing._id, {
        threadId: args.threadId,
        turnId: update.turnId,
        state: nextState,
        deltaCount: nextDeltaCount,
        latestCursor: nextLatestCursor,
        updatedAt: ts,
      });
    }),
  );
}

export async function loadStreamStatsByStreamIds(
  ctx: MutationCtx,
  args: {
    userScope: string;
    streamIds: string[];
  },
): Promise<Array<{ streamId: string; latestCursor: number }>> {
  const uniqueStreamIds = Array.from(new Set(args.streamIds));
  if (uniqueStreamIds.length === 0) {
    return [];
  }
  const rows: Array<{ streamId: string; latestCursor: number }> = [];
  for (const streamId of uniqueStreamIds) {
    const row = await getByStreamId(ctx, args.userScope, streamId);
    if (!row) {
      continue;
    }
    rows.push({ streamId: row.streamId, latestCursor: row.latestCursor });
  }
  return rows;
}

export function identifyStaleStreamingStatIds(
  args: {
    activeStreamIds: Set<string>;
    stats: Array<{
      streamId: string;
      state: StreamStateKind;
    }>;
  },
): Set<string> {
  const staleStreaming = args.stats.filter(
    (stat) => stat.state === "streaming" && !args.activeStreamIds.has(stat.streamId),
  );
  if (staleStreaming.length === 0) {
    return new Set();
  }
  return new Set(staleStreaming.map((stat) => stat.streamId));
}

export async function setStreamStatState(
  ctx: MutationCtx,
  args: EnsureStreamStatArgs,
): Promise<void> {
  await ensureStreamStat(ctx, args);
}
