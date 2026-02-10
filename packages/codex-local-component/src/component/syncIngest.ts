import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type { MutationCtx } from "./_generated/server.js";
import { authzError, now, requireThreadForActor, requireTurnForActor } from "./utils.js";
import {
  parseDurableMessageDeltaEvent,
  parseDurableMessageEvent,
  parseApprovalRequest,
  parseApprovalResolution,
  pickHigherPriorityTerminalStatus,
  terminalStatusForEvent,
  type ApprovalRequest,
  type ApprovalResolution,
  type TerminalTurnStatus,
} from "./syncHelpers.js";
import {
  CLEANUP_SWEEP_MIN_INTERVAL_MS,
  DELTA_EVENT_KINDS,
  DELTA_TTL_MS,
  DEFAULT_STREAM_DELETE_BATCH_SIZE,
  HEARTBEAT_WRITE_MIN_INTERVAL_MS,
  LIFECYCLE_EVENT_KINDS,
  STALE_SWEEP_MIN_INTERVAL_MS,
  resolveRuntimeOptions,
  syncError,
  type SyncRuntimeInput,
} from "./syncRuntime.js";
import {
  addStreamDeltaStats,
  ensureStreamStat,
  setStreamStatState,
} from "./streamStats.js";

type DurableMessageStatus = "streaming" | "completed" | "failed" | "interrupted";
type CachedMessage = {
  _id: GenericId<"codex_messages">;
  status: DurableMessageStatus;
  text: string;
};
type CachedApproval = {
  _id: GenericId<"codex_approvals">;
  status: "pending" | "accepted" | "declined";
};
type CachedStream = {
  _id: GenericId<"codex_streams">;
  turnId: string;
  state: { kind: "streaming" | "finished" | "aborted" };
};

export type StreamInboundEvent = {
  type: "stream_delta";
  eventId: string;
  turnId: string;
  streamId: string;
  kind: string;
  payloadJson: string;
  cursorStart: number;
  cursorEnd: number;
  createdAt: number;
};

export type LifecycleInboundEvent = {
  type: "lifecycle_event";
  eventId: string;
  turnId?: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
};

export type InboundEvent = StreamInboundEvent | LifecycleInboundEvent;

type PushEventsArgs = {
  actor: {
    tenantId: string;
    userId: string;
    deviceId: string;
  };
  sessionId: string;
  threadId: string;
  streamDeltas: StreamInboundEvent[];
  lifecycleEvents: LifecycleInboundEvent[];
  runtime?: SyncRuntimeInput;
};

type HeartbeatArgs = {
  actor: {
    tenantId: string;
    userId: string;
    deviceId: string;
  };
  sessionId: string;
  threadId: string;
  lastEventCursor: number;
};

type EnsureSessionArgs = HeartbeatArgs;

type EnsureSessionResult = {
  sessionId: string;
  threadId: string;
  status: "created" | "active";
};

type IngestSafeArgs = PushEventsArgs & {
  ensureLastEventCursor?: number;
};

type IngestSafeErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_THREAD_MISMATCH"
  | "SESSION_DEVICE_MISMATCH"
  | "OUT_OF_ORDER"
  | "REPLAY_GAP"
  | "UNKNOWN";

type IngestSafeResult = {
  status: "ok" | "partial" | "session_recovered" | "rejected";
  ingestStatus: "ok" | "partial";
  ackedStreams: Array<{ streamId: string; ackCursorEnd: number }>;
  recovery?: {
    action: "session_rebound";
    sessionId: string;
    threadId: string;
  };
  errors: Array<{
    code: IngestSafeErrorCode;
    message: string;
    recoverable: boolean;
  }>;
};

const RECOVERABLE_INGEST_CODES = new Set([
  "E_SYNC_SESSION_NOT_FOUND",
  "E_SYNC_SESSION_THREAD_MISMATCH",
  "E_SYNC_SESSION_DEVICE_MISMATCH",
]);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSyncErrorCode(error: unknown): string | null {
  const message = getErrorMessage(error);
  const match = /^\[([A-Z0-9_]+)\]/.exec(message);
  return match?.[1] ?? null;
}

function mapIngestSafeCode(rawCode: string | null): IngestSafeErrorCode {
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

function syntheticTurnStatusForEvent(
  kind: string,
  payloadJson: string,
): "queued" | "inProgress" | "completed" | "interrupted" | "failed" {
  const terminal = terminalStatusForEvent(kind, payloadJson);
  if (terminal?.status === "completed") {
    return "completed";
  }
  if (terminal?.status === "interrupted") {
    return "interrupted";
  }
  if (terminal?.status === "failed") {
    return "failed";
  }
  if (kind === "turn/started" || kind.startsWith("item/")) {
    return "inProgress";
  }
  return "queued";
}

export async function ingestHandler(
  ctx: MutationCtx,
  args: PushEventsArgs,
): Promise<{
  ackedStreams: Array<{ streamId: string; ackCursorEnd: number }>;
  ingestStatus: "ok" | "partial";
}> {
  await requireThreadForActor(ctx, args.actor, args.threadId);
  const runtime = resolveRuntimeOptions(args.runtime);
  const deltas: InboundEvent[] = [...args.streamDeltas, ...args.lifecycleEvents];
  deltas.sort((a, b) => a.createdAt - b.createdAt);

  if (deltas.length === 0) {
    syncError("E_SYNC_EMPTY_BATCH", "ingest received an empty delta batch");
  }

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

  let lastPersistedCursor = session.lastEventCursor;
  let persistedAnyEvent = false;
  const inBatchEventIds = new Set<string>();
  const knownTurnIds = new Set<string>();
  const startedTurns = new Set<string>();
  const terminalTurns = new Map<string, TerminalTurnStatus>();
  const pendingApprovals = new Map<string, ApprovalRequest>();
  const resolvedApprovals = new Map<string, ApprovalResolution>();
  const messageOrderCacheByTurn = new Map<string, number>();
  const messageByKey = new Map<string, CachedMessage | null>();
  const streamById = new Map<string, CachedStream | null>();
  const approvalByKey = new Map<string, CachedApproval | null>();
  const persistedStatsByStreamId = new Map<
    string,
    { threadId: string; turnId: string; latestCursor: number; deltaCount: number }
  >();
  const streamCheckpointCursorByStreamId = new Map<string, number>();
  let ingestStatus: "ok" | "partial" = "ok";
  const streamStats = await ctx.db
    .query("codex_stream_stats")
    .withIndex("tenantId_threadId", (q) =>
      q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId),
    )
    .take(500);
  const expectedCursorByStreamId = new Map<string, number>(
    streamStats.map((stat) => [String(stat.streamId), Number(stat.latestCursor)]),
  );

  const nextOrderForTurn = async (turnId: string): Promise<number> => {
    const cached = messageOrderCacheByTurn.get(turnId);
    if (cached !== undefined) {
      messageOrderCacheByTurn.set(turnId, cached + 1);
      return cached;
    }

    const lastMessage = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_turnId_orderInTurn", (q) =>
        q
          .eq("tenantId", args.actor.tenantId)
          .eq("threadId", args.threadId)
          .eq("turnId", turnId),
      )
      .order("desc")
      .take(1);
    const next = (lastMessage[0]?.orderInTurn ?? -1) + 1;
    messageOrderCacheByTurn.set(turnId, next + 1);
    return next;
  };

  const messageKey = (turnId: string, messageId: string): string =>
    `${args.actor.tenantId}:${args.threadId}:${turnId}:${messageId}`;

  const approvalKey = (turnId: string, itemId: string): string =>
    `${args.actor.tenantId}:${args.threadId}:${turnId}:${itemId}`;

  const getMessageRecord = async (turnId: string, messageId: string) => {
    const key = messageKey(turnId, messageId);
    if (messageByKey.has(key)) {
      return messageByKey.get(key);
    }
    const existing = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_turnId_messageId", (q) =>
        q
          .eq("tenantId", args.actor.tenantId)
          .eq("threadId", args.threadId)
          .eq("turnId", turnId)
          .eq("messageId", messageId),
      )
      .first();
    const normalized = existing
      ? {
          _id: existing._id,
          status: existing.status,
          text: existing.text,
        }
      : null;
    messageByKey.set(key, normalized);
    return normalized;
  };

  const setMessageRecord = (turnId: string, messageId: string, value: CachedMessage | null) => {
    messageByKey.set(messageKey(turnId, messageId), value);
  };

  const getApprovalRecord = async (turnId: string, itemId: string) => {
    const key = approvalKey(turnId, itemId);
    if (approvalByKey.has(key)) {
      return approvalByKey.get(key);
    }
    const existing = await ctx.db
      .query("codex_approvals")
      .withIndex("tenantId_threadId_turnId_itemId", (q) =>
        q
          .eq("tenantId", args.actor.tenantId)
          .eq("threadId", args.threadId)
          .eq("turnId", turnId)
          .eq("itemId", itemId),
      )
      .first();
    const normalized = existing
      ? {
          _id: existing._id,
          status: existing.status,
        }
      : null;
    approvalByKey.set(key, normalized);
    return normalized;
  };

  const setApprovalRecord = (turnId: string, itemId: string, value: CachedApproval | null) => {
    approvalByKey.set(approvalKey(turnId, itemId), value);
  };

  const getStreamRecord = async (streamId: string) => {
    if (streamById.has(streamId)) {
      return streamById.get(streamId);
    }
    const stream = await ctx.db
      .query("codex_streams")
      .withIndex("tenantId_streamId", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("streamId", streamId),
      )
      .first();
    const normalized = stream
      ? {
          _id: stream._id,
          turnId: stream.turnId,
          state: { kind: stream.state.kind },
        }
      : null;
    streamById.set(streamId, normalized);
    return normalized;
  };

  const setStreamRecord = (streamId: string, value: CachedStream | null) => {
    streamById.set(streamId, value);
  };

  for (const delta of deltas) {
    const turnId = delta.turnId;

    if (turnId && !knownTurnIds.has(turnId)) {
      const existingTurn = await ctx.db
        .query("codex_turns")
        .withIndex("tenantId_threadId_turnId", (q) =>
          q
            .eq("tenantId", args.actor.tenantId)
            .eq("threadId", args.threadId)
            .eq("turnId", turnId),
        )
        .first();

      if (!existingTurn) {
        const syntheticStatus = syntheticTurnStatusForEvent(delta.kind, delta.payloadJson);
        await ctx.db.insert("codex_turns", {
          tenantId: args.actor.tenantId,
          userId: args.actor.userId,
          threadId: args.threadId,
          turnId,
          status: syntheticStatus,
          idempotencyKey: `sync:${args.threadId}:${turnId}`,
          startedAt: now(),
          ...(syntheticStatus === "completed" ||
          syntheticStatus === "interrupted" ||
          syntheticStatus === "failed"
            ? { completedAt: now() }
            : {}),
        });
      } else if (existingTurn.userId !== args.actor.userId) {
        authzError(
          "E_AUTH_TURN_FORBIDDEN",
          `User ${args.actor.userId} is not allowed to access turn ${turnId}`,
        );
      }
      knownTurnIds.add(turnId);
    }

    if (turnId && delta.kind === "turn/started") {
      startedTurns.add(turnId);
    }

    if (turnId) {
      const terminal = terminalStatusForEvent(delta.kind, delta.payloadJson);
      if (terminal) {
        const current = terminalTurns.get(turnId);
        terminalTurns.set(turnId, pickHigherPriorityTerminalStatus(current, terminal));
      }

      const approvalRequest = parseApprovalRequest(delta.kind, delta.payloadJson);
      if (approvalRequest) {
        pendingApprovals.set(`${turnId}:${approvalRequest.itemId}`, approvalRequest);
      }

      const approvalResolution = parseApprovalResolution(delta.kind, delta.payloadJson);
      if (approvalResolution) {
        resolvedApprovals.set(`${turnId}:${approvalResolution.itemId}`, approvalResolution);
      }

      const durableMessage = parseDurableMessageEvent(delta.kind, delta.payloadJson);
      if (durableMessage) {
        const existing = await getMessageRecord(turnId, durableMessage.messageId);

        if (!existing) {
          const nextOrder = await nextOrderForTurn(turnId);

          const newId = await ctx.db.insert("codex_messages", {
            tenantId: args.actor.tenantId,
            userId: args.actor.userId,
            threadId: args.threadId,
            turnId,
            messageId: durableMessage.messageId,
            role: durableMessage.role,
            status: durableMessage.status,
            text: durableMessage.text,
            sourceItemType: durableMessage.sourceItemType,
            orderInTurn: nextOrder,
            payloadJson: durableMessage.payloadJson,
            ...(durableMessage.status === "failed" ? { error: "item failed" } : {}),
            createdAt: delta.createdAt,
            updatedAt: now(),
            ...(durableMessage.status !== "streaming" ? { completedAt: now() } : {}),
          });
          setMessageRecord(turnId, durableMessage.messageId, {
            _id: newId,
            status: durableMessage.status,
            text: durableMessage.text,
          });
        } else {
          const nextStatus = (() => {
            if (existing.status === "failed") {
              return "failed" as DurableMessageStatus;
            }
            if (existing.status === "interrupted" && durableMessage.status !== "failed") {
              return "interrupted" as DurableMessageStatus;
            }
            if (durableMessage.status === "streaming") {
              return existing.status;
            }
            return durableMessage.status;
          })();

          await ctx.db.patch(existing._id, {
            role: durableMessage.role,
            status: nextStatus,
            text: durableMessage.text,
            sourceItemType: durableMessage.sourceItemType,
            payloadJson: durableMessage.payloadJson,
            ...(nextStatus === "failed" ? { error: "item failed" } : {}),
            updatedAt: now(),
            ...(nextStatus !== "streaming" ? { completedAt: now() } : {}),
          });
          setMessageRecord(turnId, durableMessage.messageId, {
            ...existing,
            status: nextStatus,
            text: durableMessage.text,
          });
        }
      }

      const durableDelta = parseDurableMessageDeltaEvent(delta.kind, delta.payloadJson);
      if (durableDelta) {
        const existing = await getMessageRecord(turnId, durableDelta.messageId);

        if (!existing) {
          const nextOrder = await nextOrderForTurn(turnId);
          const messageId = await ctx.db.insert("codex_messages", {
            tenantId: args.actor.tenantId,
            userId: args.actor.userId,
            threadId: args.threadId,
            turnId,
            messageId: durableDelta.messageId,
            role: "assistant",
            status: "streaming",
            text: durableDelta.delta,
            sourceItemType: "agentMessage",
            orderInTurn: nextOrder,
            payloadJson: JSON.stringify({
              type: "agentMessage",
              id: durableDelta.messageId,
              text: durableDelta.delta,
            }),
            createdAt: delta.createdAt,
            updatedAt: now(),
          });
          setMessageRecord(turnId, durableDelta.messageId, {
            _id: messageId,
            status: "streaming",
            text: durableDelta.delta,
          });
        } else if (existing.status === "streaming") {
          const nextText = `${existing.text}${durableDelta.delta}`;
          await ctx.db.patch(existing._id, {
            text: nextText,
            payloadJson: JSON.stringify({
              type: "agentMessage",
              id: durableDelta.messageId,
              text: nextText,
            }),
            updatedAt: now(),
          });
          setMessageRecord(turnId, durableDelta.messageId, {
            ...existing,
            text: nextText,
          });
        }
      }
    }

    if (delta.type === "lifecycle_event") {
      const existingLifecycle = await ctx.db
        .query("codex_lifecycle_events")
        .withIndex("tenantId_threadId_eventId", (q) =>
          q
            .eq("tenantId", args.actor.tenantId)
            .eq("threadId", args.threadId)
            .eq("eventId", delta.eventId),
        )
        .first();
      if (!existingLifecycle) {
        await ctx.db.insert("codex_lifecycle_events", {
          tenantId: args.actor.tenantId,
          threadId: args.threadId,
          eventId: delta.eventId,
          kind: delta.kind,
          payloadJson: delta.payloadJson,
          createdAt: delta.createdAt,
          ...(delta.turnId ? { turnId: delta.turnId } : {}),
        });
      }
      continue;
    }

    const stream = await getStreamRecord(delta.streamId);
    if (!stream) {
      const streamId = await ctx.db.insert("codex_streams", {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId: delta.turnId,
        streamId: delta.streamId,
        state: { kind: "streaming", lastHeartbeatAt: now() },
        startedAt: now(),
      });
      setStreamRecord(delta.streamId, {
        _id: streamId,
        state: { kind: "streaming" as const },
        turnId: delta.turnId,
      });
      await ensureStreamStat(ctx, {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId: delta.turnId,
        streamId: delta.streamId,
        state: "streaming",
      });
    }

    if (delta.cursorStart >= delta.cursorEnd) {
      syncError(
        "E_SYNC_INVALID_CURSOR_RANGE",
        `Invalid cursor range start=${delta.cursorStart} end=${delta.cursorEnd} for eventId=${delta.eventId}`,
      );
    }
    const streamExpectedCursor = expectedCursorByStreamId.get(delta.streamId) ?? 0;
    const existingStreamEvent = await ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("tenantId_streamId_eventId", (q) =>
        q
          .eq("tenantId", args.actor.tenantId)
          .eq("streamId", delta.streamId)
          .eq("eventId", delta.eventId),
      )
      .first();
    if (existingStreamEvent) {
      expectedCursorByStreamId.set(
        delta.streamId,
        Math.max(streamExpectedCursor, Number(existingStreamEvent.cursorEnd)),
      );
      streamCheckpointCursorByStreamId.set(
        delta.streamId,
        Math.max(
          streamCheckpointCursorByStreamId.get(delta.streamId) ?? 0,
          Number(existingStreamEvent.cursorEnd),
        ),
      );
      continue;
    }
    if (delta.cursorStart < streamExpectedCursor) {
      syncError(
        "E_SYNC_OUT_OF_ORDER",
        `Expected cursorStart>=${streamExpectedCursor} for streamId=${delta.streamId} but got ${delta.cursorStart} for eventId=${delta.eventId}`,
      );
    }
    if (delta.cursorStart > streamExpectedCursor) {
      ingestStatus = "partial";
    }
    if (inBatchEventIds.has(delta.eventId)) {
      syncError("E_SYNC_DUP_EVENT_IN_BATCH", `Duplicate eventId in request batch: ${delta.eventId}`);
    }
    inBatchEventIds.add(delta.eventId);

    const shouldPersist =
      LIFECYCLE_EVENT_KINDS.has(delta.kind) ||
      (runtime.saveStreamDeltas && DELTA_EVENT_KINDS.has(delta.kind));
    if (shouldPersist) {
      await ctx.db.insert("codex_stream_deltas_ttl", {
        tenantId: args.actor.tenantId,
        streamId: delta.streamId,
        turnId: delta.turnId,
        eventId: delta.eventId,
        cursorStart: delta.cursorStart,
        cursorEnd: delta.cursorEnd,
        kind: delta.kind,
        payloadJson: delta.payloadJson,
        createdAt: delta.createdAt,
        expiresAt: now() + DELTA_TTL_MS,
      });
      const existing = persistedStatsByStreamId.get(delta.streamId);
      if (existing) {
        existing.deltaCount += 1;
        existing.latestCursor = Math.max(existing.latestCursor, delta.cursorEnd);
      } else {
        persistedStatsByStreamId.set(delta.streamId, {
          threadId: args.threadId,
          turnId: delta.turnId,
          latestCursor: delta.cursorEnd,
          deltaCount: 1,
        });
      }
      lastPersistedCursor = delta.cursorEnd;
      persistedAnyEvent = true;
    }
    streamCheckpointCursorByStreamId.set(
      delta.streamId,
      Math.max(streamCheckpointCursorByStreamId.get(delta.streamId) ?? 0, delta.cursorEnd),
    );
    expectedCursorByStreamId.set(delta.streamId, delta.cursorEnd);
  }

  for (const turnId of startedTurns) {
    const turn = await requireTurnForActor(ctx, args.actor, args.threadId, turnId);
    if (turn.status === "queued") {
      await ctx.db.patch(turn._id, { status: "inProgress" });
    }
  }

  for (const [turnId, terminal] of terminalTurns) {
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("turnsInternal:finalizeTurnFromStream"),
      {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId,
        status: terminal.status,
        ...(terminal.error ? { error: terminal.error } : {}),
      },
    );

    if (terminal.status === "failed" || terminal.status === "interrupted") {
      const pendingMessages = await ctx.db
        .query("codex_messages")
        .withIndex("tenantId_threadId_turnId_status", (q) =>
          q
            .eq("tenantId", args.actor.tenantId)
            .eq("threadId", args.threadId)
            .eq("turnId", turnId)
            .eq("status", "streaming"),
        )
        .take(500);

      await Promise.all(
        pendingMessages.map((message) =>
          ctx.db.patch(message._id, {
            status: terminal.status,
            ...(terminal.error ? { error: terminal.error } : {}),
            updatedAt: now(),
            completedAt: now(),
          }),
        ),
      );
    }
  }

  for (const [key, approval] of pendingApprovals) {
    const turnId = key.split(":")[0];
    if (!turnId) {
      continue;
    }
    const existing = await getApprovalRecord(turnId, approval.itemId);

    if (!existing) {
      const approvalId = await ctx.db.insert("codex_approvals", {
        tenantId: args.actor.tenantId,
        userId: args.actor.userId,
        threadId: args.threadId,
        turnId,
        itemId: approval.itemId,
        kind: approval.kind,
        status: "pending",
        ...(approval.reason ? { reason: approval.reason } : {}),
        createdAt: now(),
      });
      setApprovalRecord(turnId, approval.itemId, {
        _id: approvalId,
        status: "pending",
      });
    }
  }

  for (const [key, resolution] of resolvedApprovals) {
    const turnId = key.split(":")[0];
    if (!turnId) {
      continue;
    }
    const existing = await getApprovalRecord(turnId, resolution.itemId);

    if (!existing || existing.status !== "pending") {
      continue;
    }

    await ctx.db.patch(existing._id, {
      status: resolution.status,
      decidedBy: "runtime",
      decidedAt: now(),
    });
    setApprovalRecord(turnId, resolution.itemId, {
      ...existing,
      status: resolution.status,
    });
  }

  const terminalByStream = new Map<
    string,
    { status: "completed" | "failed" | "interrupted"; error?: string }
  >();
  for (const delta of deltas) {
    if (delta.type !== "stream_delta") {
      continue;
    }
    const terminal = terminalStatusForEvent(delta.kind, delta.payloadJson);
    if (!terminal) {
      continue;
    }
    const current = terminalByStream.get(delta.streamId);
    terminalByStream.set(delta.streamId, pickHigherPriorityTerminalStatus(current, terminal));
  }

  for (const [streamId, terminal] of terminalByStream) {
    const stream = await getStreamRecord(streamId);

    if (!stream || stream.state.kind !== "streaming") {
      continue;
    }

    const endedAt = now();
    const cleanupFnId = await ctx.scheduler.runAfter(
      runtime.finishedStreamDeleteDelayMs,
      makeFunctionReference<"mutation">("streams:cleanupFinishedStream"),
      {
        tenantId: args.actor.tenantId,
        streamId,
        batchSize: DEFAULT_STREAM_DELETE_BATCH_SIZE,
      },
    );

    if (terminal.status === "completed") {
      await ctx.db.patch(stream._id, {
        state: { kind: "finished", endedAt },
        endedAt,
        cleanupScheduledAt: endedAt,
        cleanupFnId,
      });
      await setStreamStatState(ctx, {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId: stream.turnId,
        streamId,
        state: "finished",
      });
      setStreamRecord(streamId, {
        ...stream,
        state: { kind: "finished" as const },
      });
    } else {
      await ctx.db.patch(stream._id, {
        state: {
          kind: "aborted",
          reason: terminal.error ?? terminal.status,
          endedAt,
        },
        endedAt,
        cleanupScheduledAt: endedAt,
        cleanupFnId,
      });
      await setStreamStatState(ctx, {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId: stream.turnId,
        streamId,
        state: "aborted",
      });
      setStreamRecord(streamId, {
        ...stream,
        state: { kind: "aborted" as const },
      });
    }
  }

  for (const [streamId, stats] of persistedStatsByStreamId) {
    await addStreamDeltaStats(ctx, {
      tenantId: args.actor.tenantId,
      threadId: stats.threadId,
      turnId: stats.turnId,
      streamId,
      deltaCount: stats.deltaCount,
      latestCursor: stats.latestCursor,
    });
  }

  const sessionPatch: {
    status: "active";
    lastHeartbeatAt?: number;
    lastEventCursor?: number;
  } = { status: "active" };

  const nextLastEventCursor = Math.max(session.lastEventCursor, lastPersistedCursor);
  if (nextLastEventCursor !== session.lastEventCursor) {
    sessionPatch.lastEventCursor = nextLastEventCursor;
  }

  const nowMs = now();
  if (persistedAnyEvent || nowMs - session.lastHeartbeatAt >= HEARTBEAT_WRITE_MIN_INTERVAL_MS) {
    sessionPatch.lastHeartbeatAt = nowMs;
  }

  await ctx.db.patch(session._id, sessionPatch);

  const streamCheckpointRows = await ctx.db
    .query("codex_stream_checkpoints")
    .withIndex("tenantId_threadId_deviceId_streamId", (q) =>
      q
        .eq("tenantId", args.actor.tenantId)
        .eq("threadId", args.threadId)
        .eq("deviceId", args.actor.deviceId),
    )
    .take(2000);
  const existingCheckpointByStreamId = new Map(
    streamCheckpointRows.map((row) => [row.streamId, row]),
  );
  for (const [streamId, cursor] of streamCheckpointCursorByStreamId) {
    const existing = existingCheckpointByStreamId.get(streamId);
    if (existing) {
      if (cursor > Number(existing.ackedCursor)) {
        await ctx.db.patch(existing._id, {
          ackedCursor: cursor,
          updatedAt: now(),
        });
      }
      continue;
    }
    await ctx.db.insert("codex_stream_checkpoints", {
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      deviceId: args.actor.deviceId,
      threadId: args.threadId,
      streamId,
      ackedCursor: cursor,
      updatedAt: now(),
    });
  }

  if (nowMs - session.lastHeartbeatAt >= STALE_SWEEP_MIN_INTERVAL_MS) {
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("sessions:timeoutStaleSessions"),
      {
        tenantId: args.actor.tenantId,
        staleBeforeMs: nowMs - 1000 * 60 * 3,
      },
    );
  }

  if (persistedAnyEvent && nowMs - session.lastHeartbeatAt >= CLEANUP_SWEEP_MIN_INTERVAL_MS) {
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("streams:cleanupExpiredDeltas"),
      {
        nowMs,
        batchSize: 1000,
      },
    );
  }

  const ackedStreams = Array.from(streamCheckpointCursorByStreamId.entries())
    .map(([streamId, ackCursorEnd]) => ({ streamId, ackCursorEnd }))
    .sort((a, b) => a.streamId.localeCompare(b.streamId));

  return { ackedStreams, ingestStatus };
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
  await requireThreadForActor(ctx, args.actor, args.threadId);

  const existing = await ctx.db
    .query("codex_stream_checkpoints")
    .withIndex("tenantId_threadId_deviceId_streamId", (q) =>
      q
        .eq("tenantId", args.actor.tenantId)
        .eq("threadId", args.threadId)
        .eq("deviceId", args.actor.deviceId)
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
    tenantId: args.actor.tenantId,
    userId: args.actor.userId,
    deviceId: args.actor.deviceId,
    threadId: args.threadId,
    streamId: args.streamId,
    ackedCursor: Math.max(0, Math.floor(args.cursor)),
    updatedAt: now(),
  });
  return { ok: true };
}

async function upsertSessionHeartbeat(
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
    const initialMessage = getErrorMessage(initialError);
    const recoverable = initialCode ? RECOVERABLE_INGEST_CODES.has(initialCode) : false;

    if (!recoverable) {
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
            message: getErrorMessage(retryError),
            recoverable: retryCode ? RECOVERABLE_INGEST_CODES.has(retryCode) : false,
          },
        ],
      };
    }
  }
}
