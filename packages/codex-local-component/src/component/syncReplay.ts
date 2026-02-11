import type { QueryCtx } from "./_generated/server.js";
import { requireThreadForActor, requireTurnForActor } from "./utils.js";
import { userScopeFromActor } from "./scope.js";
import { parseItemSnapshot, type ItemSnapshot } from "./syncHelpers.js";
import { resolveRuntimeOptions, type SyncRuntimeInput } from "./syncRuntime.js";

type ActorContext = {
  userId?: string;
};

type PullStateArgs = {
  actor: ActorContext;
  threadId: string;
  streamCursorsById: Array<{ streamId: string; cursor: number }>;
  runtime?: SyncRuntimeInput;
};

type ResumeFromCursorArgs = {
  actor: ActorContext;
  threadId: string;
  turnId: string;
  fromCursor: number;
  runtime?: SyncRuntimeInput;
};

type WindowStatus = "ok" | "rebased" | "stale";

type StreamWindow = {
  streamId: string;
  status: WindowStatus;
  serverCursorStart: number;
  serverCursorEnd: number;
};

type NormalizedDelta = {
  streamId: string;
  cursorStart: number;
  cursorEnd: number;
  kind: string;
  payloadJson: string;
};

function takeContiguousDeltas<T extends { cursorStart: number; cursorEnd: number }>(
  deltas: T[],
  requestedCursor: number,
): { deltas: T[]; startCursor: number } {
  if (deltas.length === 0) {
    return { deltas: [], startCursor: requestedCursor };
  }

  let startCursor = requestedCursor;
  const first = deltas[0]!;
  if (first.cursorStart > startCursor) {
    startCursor = first.cursorStart;
  }

  const contiguous: T[] = [];
  let expected = startCursor;
  for (const delta of deltas) {
    if (delta.cursorStart !== expected) {
      break;
    }
    contiguous.push(delta);
    expected = delta.cursorEnd;
  }

  return { deltas: contiguous, startCursor };
}

async function computeStreamReplayWindow(
  ctx: QueryCtx,
  args: {
    actor: ActorContext;
    threadId: string;
    streamId: string;
    requestedCursor: number;
    maxDeltas: number;
  },
): Promise<{ window: StreamWindow; deltas: NormalizedDelta[]; nextCursor: number }> {
  const checkpoint = await ctx.db
    .query("codex_stream_checkpoints")
    .withIndex("userScope_threadId_streamId", (q) =>
      q
        .eq("userScope", userScopeFromActor(args.actor))
        .eq("threadId", args.threadId)
        .eq("streamId", args.streamId),
    )
    .first();

  let effectiveCursor = Math.max(args.requestedCursor, Number(checkpoint?.ackedCursor ?? 0));
  let status: WindowStatus = "ok";

  const earliest = await ctx.db
    .query("codex_stream_deltas_ttl")
    .withIndex("userScope_streamId_cursorStart", (q) =>
      q.eq("userScope", userScopeFromActor(args.actor)).eq("streamId", args.streamId),
    )
    .take(1);

  if (earliest.length > 0 && effectiveCursor < Number(earliest[0]!.cursorStart)) {
    effectiveCursor = Number(earliest[0]!.cursorStart);
    status = "rebased";
  }

  const deltas = await ctx.db
    .query("codex_stream_deltas_ttl")
    .withIndex("userScope_streamId_cursorStart", (q) =>
      q
        .eq("userScope", userScopeFromActor(args.actor))
        .eq("streamId", args.streamId)
        .gte("cursorStart", effectiveCursor),
    )
    .take(args.maxDeltas);

  const normalizedDeltas = deltas.map((delta) => ({
    streamId: String(delta.streamId),
    cursorStart: Number(delta.cursorStart),
    cursorEnd: Number(delta.cursorEnd),
    kind: String(delta.kind),
    payloadJson: String(delta.payloadJson),
  }));

  const contiguous = takeContiguousDeltas(normalizedDeltas, effectiveCursor);
  const serverCursorEnd = contiguous.deltas.reduce(
    (max, delta) => Math.max(max, delta.cursorEnd),
    contiguous.startCursor,
  );

  if (contiguous.deltas.length === 0) {
    const stat = await ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_streamId", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("streamId", args.streamId),
      )
      .first();
    if (stat && Number(stat.latestCursor) > contiguous.startCursor) {
      status = "stale";
    }
  }

  return {
    window: {
      streamId: args.streamId,
      status,
      serverCursorStart: contiguous.startCursor,
      serverCursorEnd,
    },
    deltas: contiguous.deltas,
    nextCursor: serverCursorEnd,
  };
}

export async function replayHandler(ctx: QueryCtx, args: PullStateArgs) {
  await requireThreadForActor(ctx, args.actor, args.threadId);
  const runtime = resolveRuntimeOptions(args.runtime);

  const streams = await ctx.db
    .query("codex_streams")
    .withIndex("userScope_threadId_state", (q) =>
      q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
    )
    .take(200);

  const streamWindows: StreamWindow[] = [];
  const nextCheckpoints: Array<{ streamId: string; cursor: number }> = [];
  const deltaResults: NormalizedDelta[] = [];

  let remainingRequestBudget = runtime.maxDeltasPerRequestRead;

  for (const cursor of args.streamCursorsById) {
    if (remainingRequestBudget <= 0) {
      break;
    }

    const perStreamCap = Math.min(runtime.maxDeltasPerStreamRead, remainingRequestBudget);
    const replay = await computeStreamReplayWindow(ctx, {
      actor: args.actor,
      threadId: args.threadId,
      streamId: cursor.streamId,
      requestedCursor: cursor.cursor,
      maxDeltas: perStreamCap,
    });

    streamWindows.push(replay.window);
    nextCheckpoints.push({ streamId: cursor.streamId, cursor: replay.nextCursor });
    deltaResults.push(...replay.deltas);
    remainingRequestBudget -= replay.deltas.length;
  }

  const snapshotById = new Map<string, ItemSnapshot>();
  for (const delta of deltaResults) {
    const snapshot = parseItemSnapshot(delta.kind, delta.payloadJson, delta.cursorEnd);
    if (!snapshot) {
      continue;
    }
    const current = snapshotById.get(snapshot.itemId);
    if (!current || snapshot.cursorEnd >= current.cursorEnd) {
      snapshotById.set(snapshot.itemId, snapshot);
    }
  }
  const snapshots = Array.from(snapshotById.values()).sort((a, b) => b.cursorEnd - a.cursorEnd);

  return {
    streams: streams.map((stream) => ({
      streamId: String(stream.streamId),
      state: String(stream.state.kind),
    })),
    streamWindows,
    nextCheckpoints,
    deltas: deltaResults,
    snapshots: snapshots.map((item) => ({
      itemId: item.itemId,
      itemType: item.itemType,
      status: item.status,
      payloadJson: item.payloadJson,
    })),
  };
}

export async function listCheckpointsHandler(
  ctx: QueryCtx,
  args: { actor: ActorContext; threadId: string },
) {
  await requireThreadForActor(ctx, args.actor, args.threadId);
  const rows = await ctx.db
    .query("codex_stream_checkpoints")
    .withIndex("userScope_threadId_streamId", (q) =>
      q
        .eq("userScope", userScopeFromActor(args.actor))
        .eq("threadId", args.threadId)
    )
    .take(2000);

  return rows.map((row) => ({
    streamId: String(row.streamId),
    cursor: Number(row.ackedCursor),
  }));
}

export async function resumeReplayHandler(
  ctx: QueryCtx,
  args: ResumeFromCursorArgs,
) {
  await requireThreadForActor(ctx, args.actor, args.threadId);
  await requireTurnForActor(ctx, args.actor, args.threadId, args.turnId);
  const runtime = resolveRuntimeOptions(args.runtime);

  const streamId = `${args.threadId}:${args.turnId}:0`;
  const replay = await computeStreamReplayWindow(ctx, {
    actor: args.actor,
    threadId: args.threadId,
    streamId,
    requestedCursor: args.fromCursor,
    maxDeltas: runtime.maxDeltasPerRequestRead,
  });

  return {
    streamWindow: replay.window,
    deltas: replay.deltas.map((delta) => ({
      cursorStart: delta.cursorStart,
      cursorEnd: delta.cursorEnd,
      kind: delta.kind,
      payloadJson: delta.payloadJson,
    })),
    nextCursor: replay.nextCursor,
  };
}
