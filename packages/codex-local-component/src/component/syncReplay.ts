import type { QueryCtx } from "./_generated/server.js";
import { requireThreadForActor, requireTurnForActor } from "./utils.js";
import { assertContinuousStreamDeltas, parseItemSnapshot, type ItemSnapshot } from "./syncHelpers.js";
import { resolveRuntimeOptions, syncError, type SyncRuntimeInput } from "./syncRuntime.js";

type ActorContext = {
  tenantId: string;
  userId: string;
  deviceId: string;
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

export async function pullStateHandler(ctx: QueryCtx, args: PullStateArgs) {
  await requireThreadForActor(ctx, args.actor, args.threadId);
  const runtime = resolveRuntimeOptions(args.runtime);

  const streams = await ctx.db
    .query("codex_streams")
    .withIndex("tenantId_threadId_state", (q) =>
      q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId),
    )
    .take(200);

  const deltaResults: Array<{
    streamId: string;
    cursorStart: number;
    cursorEnd: number;
    kind: string;
    payloadJson: string;
  }> = [];

  let remainingRequestBudget = runtime.maxDeltasPerRequestRead;

  for (const cursor of args.streamCursorsById) {
    if (remainingRequestBudget <= 0) {
      break;
    }

    const earliest = await ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("tenantId_streamId_cursorStart", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("streamId", cursor.streamId),
      )
      .take(1);

    if (earliest.length > 0 && cursor.cursor < Number(earliest[0]!.cursorStart)) {
      syncError(
        "E_SYNC_REPLAY_GAP",
        `Requested cursor ${cursor.cursor} is older than earliest retained cursor ${Number(earliest[0]!.cursorStart)} for streamId=${cursor.streamId}`,
      );
    }

    const perStreamCap = Math.min(runtime.maxDeltasPerStreamRead, remainingRequestBudget);
    const deltas = await ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("tenantId_streamId_cursorStart", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("streamId", cursor.streamId).gte("cursorStart", cursor.cursor),
      )
      .take(perStreamCap);

    const normalizedDeltas = deltas.map((delta) => ({
      cursorStart: Number(delta.cursorStart),
      cursorEnd: Number(delta.cursorEnd),
    }));
    const continuity = assertContinuousStreamDeltas(cursor.streamId, cursor.cursor, normalizedDeltas);
    if (!continuity.ok) {
      syncError(
        "E_SYNC_REPLAY_GAP",
        `Replay gap for streamId=${cursor.streamId}: expected cursorStart=${continuity.expected}, got ${continuity.actual}`,
      );
    }

    deltaResults.push(
      ...deltas.map((delta) => ({
        streamId: String(delta.streamId),
        cursorStart: Number(delta.cursorStart),
        cursorEnd: Number(delta.cursorEnd),
        kind: String(delta.kind),
        payloadJson: String(delta.payloadJson),
      })),
    );
    remainingRequestBudget -= deltas.length;
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
    deltas: deltaResults,
    snapshots: snapshots.map((item) => ({
      itemId: item.itemId,
      itemType: item.itemType,
      status: item.status,
      payloadJson: item.payloadJson,
    })),
  };
}

export async function resumeFromCursorHandler(
  ctx: QueryCtx,
  args: ResumeFromCursorArgs,
) {
  await requireThreadForActor(ctx, args.actor, args.threadId);
  await requireTurnForActor(ctx, args.actor, args.threadId, args.turnId);
  const runtime = resolveRuntimeOptions(args.runtime);

  const streamId = `${args.threadId}:${args.turnId}:0`;

  const deltas = await ctx.db
    .query("codex_stream_deltas_ttl")
    .withIndex("tenantId_streamId_cursorStart", (q) =>
      q
        .eq("tenantId", args.actor.tenantId)
        .eq("streamId", streamId)
        .gte("cursorStart", args.fromCursor),
    )
    .take(runtime.maxDeltasPerRequestRead);

  const earliest = await ctx.db
    .query("codex_stream_deltas_ttl")
    .withIndex("tenantId_streamId_cursorStart", (q) =>
      q.eq("tenantId", args.actor.tenantId).eq("streamId", streamId),
    )
    .take(1);

  if (earliest.length > 0 && args.fromCursor < Number(earliest[0]!.cursorStart)) {
    syncError(
      "E_SYNC_REPLAY_GAP",
      `Requested cursor ${args.fromCursor} is older than earliest retained cursor ${Number(earliest[0]!.cursorStart)} for streamId=${streamId}`,
    );
  }

  const normalizedDeltas = deltas.map((delta) => ({
    cursorStart: Number(delta.cursorStart),
    cursorEnd: Number(delta.cursorEnd),
  }));
  const continuity = assertContinuousStreamDeltas(streamId, args.fromCursor, normalizedDeltas);
  if (!continuity.ok) {
    syncError(
      "E_SYNC_REPLAY_GAP",
      `Replay gap for streamId=${streamId}: expected cursorStart=${continuity.expected}, got ${continuity.actual}`,
    );
  }

  const nextCursor = deltas.reduce(
    (max, delta) => Math.max(max, Number(delta.cursorEnd)),
    args.fromCursor,
  );

  return {
    deltas: deltas.map((delta) => ({
      cursorStart: Number(delta.cursorStart),
      cursorEnd: Number(delta.cursorEnd),
      kind: String(delta.kind),
      payloadJson: String(delta.payloadJson),
    })),
    nextCursor,
  };
}
