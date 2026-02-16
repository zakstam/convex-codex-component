import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import {
  ingestBatchSafe,
  type HostInboundLifecycleEvent,
  type HostInboundStreamDelta,
  type HostReplayResult,
  type HostSyncRuntimeOptions,
} from "./convex.js";
import { normalizeInboundDeltas } from "./normalizeInboundDeltas.js";
import { isSessionForbidden, isThreadForbidden, isThreadMissing } from "../errors.js";

export type HostMutationRunner = {
  runMutation<Mutation extends FunctionReference<"mutation", "public" | "internal">>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ): Promise<FunctionReturnType<Mutation>>;
};

export type HostQueryRunner = {
  runQuery<Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    args: FunctionArgs<Query>,
  ): Promise<FunctionReturnType<Query>>;
};

function typedArgs<Fn extends FunctionReference<"query" | "mutation", "public" | "internal">>(
  args: FunctionArgs<Fn>,
): FunctionArgs<Fn> {
  return args;
}

export type HostActorContext = {
  userId?: string;
};

export const vHostActorContext = v.object({
  userId: v.optional(v.string()),
});

export const vHostStreamInboundEvent = v.object({
  type: v.literal("stream_delta"),
  eventId: v.string(),
  turnId: v.string(),
  streamId: v.string(),
  kind: v.string(),
  payloadJson: v.string(),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  createdAt: v.number(),
});

export const vHostLifecycleInboundEvent = v.object({
  type: v.literal("lifecycle_event"),
  eventId: v.string(),
  turnId: v.optional(v.string()),
  kind: v.string(),
  payloadJson: v.string(),
  createdAt: v.number(),
});

export const vHostSyncRuntimeOptions = v.object({
  saveStreamDeltas: v.optional(v.boolean()),
  saveReasoningDeltas: v.optional(v.boolean()),
  exposeRawReasoningDeltas: v.optional(v.boolean()),
  maxDeltasPerStreamRead: v.optional(v.number()),
  maxDeltasPerRequestRead: v.optional(v.number()),
  finishedStreamDeleteDelayMs: v.optional(v.number()),
});

export const vHostIngestSafeResult = v.object({
  status: v.union(v.literal("ok"), v.literal("partial"), v.literal("session_recovered"), v.literal("rejected")),
  ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
  ackedStreams: v.array(v.object({ streamId: v.string(), ackCursorEnd: v.number() })),
  recovery: v.optional(
    v.object({
      action: v.literal("session_rebound"),
      sessionId: v.string(),
      threadId: v.string(),
    }),
  ),
  errors: v.array(
    v.object({
      code: v.union(
        v.literal("SESSION_NOT_FOUND"),
        v.literal("SESSION_THREAD_MISMATCH"),
        v.literal("TURN_ID_REQUIRED_FOR_TURN_EVENT"),
        v.literal("TURN_ID_REQUIRED_FOR_CODEX_EVENT"),
        v.literal("OUT_OF_ORDER"),
        v.literal("REPLAY_GAP"),
        v.literal("UNKNOWN"),
      ),
      message: v.string(),
      recoverable: v.boolean(),
    }),
  ),
});

export const vHostEnsureSessionResult = v.object({
  sessionId: v.string(),
  threadId: v.string(),
  status: v.union(v.literal("created"), v.literal("active")),
});

export const vManagedServerRequestMethod = v.union(
  v.literal("item/commandExecution/requestApproval"),
  v.literal("item/fileChange/requestApproval"),
  v.literal("item/tool/requestUserInput"),
  v.literal("item/tool/call"),
);

export const vServerRequestId = v.union(v.string(), v.number());

export const vHostTurnInput = v.array(
  v.object({
    type: v.string(),
    text: v.optional(v.string()),
    url: v.optional(v.string()),
    path: v.optional(v.string()),
  }),
);

export const vHostStreamArgs = v.optional(
  v.union(
    v.object({
      kind: v.literal("list"),
      startOrder: v.optional(v.number()),
    }),
    v.object({
      kind: v.literal("deltas"),
      cursors: v.array(
        v.object({
          streamId: v.string(),
          cursor: v.number(),
        }),
      ),
    }),
  ),
);

export const vHostPersistenceStats = v.object({
  streamCount: v.number(),
  deltaCount: v.number(),
  latestCursorByStream: v.array(v.object({ streamId: v.string(), cursor: v.number() })),
});

export const vHostDurableHistoryStats = v.object({
  messageCountInPage: v.number(),
  latest: v.array(
    v.object({
      messageId: v.string(),
      turnId: v.string(),
      role: v.string(),
      status: v.string(),
      text: v.string(),
    }),
  ),
});

export const vHostDataHygiene = v.object({
  scannedStreamStats: v.number(),
  streamStatOrphans: v.number(),
  orphanStreamIds: v.array(v.string()),
});

type CodexThreadsCreateComponent = {
  threads: {
    create: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexThreadsResolveComponent = {
  threads: {
    resolve: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexTurnsComponent = {
  turns: {
    interrupt: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexSyncComponent = {
  sync: {
    ensureSession: FunctionReference<"mutation", "public" | "internal">;
    ingestSafe: FunctionReference<"mutation", "public" | "internal">;
    replay: FunctionReference<
      "query",
      "public" | "internal",
      {
        actor: HostActorContext;
        threadId: string;
        streamCursorsById: Array<{ streamId: string; cursor: number }>;
        runtime?: HostSyncRuntimeOptions;
      },
      HostReplayResult
    >;
  };
};

type CodexMessagesComponent = {
  messages: {
    listByThread: FunctionReference<"query", "public" | "internal">;
    getByTurn: FunctionReference<"query", "public" | "internal">;
  };
};

type CodexApprovalsComponent = {
  approvals: {
    listPending: FunctionReference<"query", "public" | "internal">;
    respond: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexServerRequestsComponent = {
  serverRequests: {
    listPending: FunctionReference<"query", "public" | "internal">;
    upsertPending: FunctionReference<"mutation", "public" | "internal">;
    resolve: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexThreadsStateComponent = {
  threads: {
    getState: FunctionReference<"query", "public" | "internal">;
  };
};

type CodexTokenUsageComponent = {
  tokenUsage: {
    upsert: FunctionReference<"mutation", "public" | "internal">;
    listByThread: FunctionReference<"query", "public" | "internal">;
  };
};

type CodexReasoningComponent = {
  reasoning: {
    listByThread: FunctionReference<"query", "public" | "internal">;
  };
};

export type CodexHostComponentRefs =
  & CodexThreadsCreateComponent
  & CodexThreadsResolveComponent
  & CodexTurnsComponent
  & CodexSyncComponent
  & CodexMessagesComponent
  & CodexApprovalsComponent
  & CodexServerRequestsComponent
  & CodexTokenUsageComponent
  & CodexThreadsStateComponent
  & CodexReasoningComponent;

export type CodexHostComponentsInput<Refs extends CodexHostComponentRefs = CodexHostComponentRefs> =
  | Refs
  | { codexLocal: Refs };

type EnsureThreadCreateArgs = {
  actor: HostActorContext;
  threadId: string;
  model?: string;
  cwd?: string;
};

type EnsureThreadResolveArgs = {
  actor: HostActorContext;
  externalThreadId?: string;
  model?: string;
  cwd?: string;
};

type EnsureSessionArgs = {
  actor: HostActorContext;
  sessionId: string;
  threadId: string;
  lastEventCursor: number;
};

type IngestEventStreamOnlyArgs = {
  actor: HostActorContext;
  sessionId: string;
  threadId: string;
  event: Omit<HostInboundStreamDelta, "type">;
};

type IngestBatchStreamOnlyArgs = {
  actor: HostActorContext;
  sessionId: string;
  threadId: string;
  deltas: Array<Omit<HostInboundStreamDelta, "type">>;
  runtime?: HostSyncRuntimeOptions;
};

type IngestEventMixedArgs = {
  actor: HostActorContext;
  sessionId: string;
  threadId: string;
  event: HostInboundStreamDelta | HostInboundLifecycleEvent;
};

type IngestBatchMixedArgs = {
  actor: HostActorContext;
  sessionId: string;
  threadId: string;
  deltas: Array<HostInboundStreamDelta | HostInboundLifecycleEvent>;
  runtime?: HostSyncRuntimeOptions;
};

type ThreadSnapshotArgs = {
  actor: HostActorContext;
  threadId: string;
};

type DurableHistoryMessage = {
  messageId: string;
  turnId: string;
  role: string;
  status: string;
  text: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
};

type StreamStatSummary = {
  streamId: string;
  deltaCount: number;
  latestCursor: number;
};

function toThreadStateQueryArgs(args: ThreadSnapshotArgs): ThreadSnapshotArgs {
  return {
    actor: args.actor,
    threadId: args.threadId,
  };
}

export function isStreamStatSummary(value: unknown): value is StreamStatSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.streamId === "string" &&
    typeof record.deltaCount === "number" &&
    typeof record.latestCursor === "number"
  );
}

function getStreamStatsCandidate(state: unknown): unknown[] | null {
  if (typeof state !== "object" || state === null || !("streamStats" in state)) {
    return null;
  }
  const streamStats = (state as { streamStats?: unknown[] | null }).streamStats;
  return Array.isArray(streamStats) ? streamStats : null;
}

function getRecentMessagesCandidate(state: unknown): DurableHistoryMessage[] | null {
  if (typeof state !== "object" || state === null || !("recentMessages" in state)) {
    return null;
  }
  const recentMessages = (state as { recentMessages?: DurableHistoryMessage[] | null }).recentMessages;
  return Array.isArray(recentMessages) ? recentMessages : null;
}

function getAllStreamsCandidate(state: unknown): Array<{ streamId: string }> | null {
  if (typeof state !== "object" || state === null || !("allStreams" in state)) {
    return null;
  }
  const allStreams = (state as { allStreams?: Array<{ streamId: string }> | null }).allStreams;
  return Array.isArray(allStreams) ? allStreams : null;
}

export function computePersistenceStats(state: { streamStats?: unknown[] | null }): {
  streamCount: number;
  deltaCount: number;
  latestCursorByStream: Array<{ streamId: string; cursor: number }>;
} {
  const streamStatsRaw = Array.isArray(state.streamStats) ? state.streamStats : [];
  const streamStats = streamStatsRaw.filter(isStreamStatSummary);

  return {
    streamCount: streamStats.length,
    deltaCount: streamStats.reduce((sum, stream) => sum + stream.deltaCount, 0),
    latestCursorByStream: streamStats.map((stream) => ({
      streamId: stream.streamId,
      cursor: stream.latestCursor,
    })),
  };
}

export function computeDurableHistoryStats(state: {
  recentMessages?: DurableHistoryMessage[] | null;
}): {
  messageCountInPage: number;
  latest: DurableHistoryMessage[];
} {
  const page = Array.isArray(state.recentMessages) ? state.recentMessages : [];
  return {
    messageCountInPage: page.length,
    latest: page.slice(0, 5).map((message) => ({
      messageId: message.messageId,
      turnId: message.turnId,
      role: message.role,
      status: message.status,
      text: message.text,
    })),
  };
}

export function computeDataHygiene(state: {
  streamStats?: unknown[] | null;
  allStreams?: Array<{ streamId: string }> | null;
}): {
  scannedStreamStats: number;
  streamStatOrphans: number;
  orphanStreamIds: string[];
} {
  const streamStatsRaw = Array.isArray(state.streamStats) ? state.streamStats : [];
  const allStreamsRaw = Array.isArray(state.allStreams) ? state.allStreams : [];
  const liveStreamIds = new Set(allStreamsRaw.map((stream) => String(stream.streamId)));
  const streamStats = streamStatsRaw.filter(isStreamStatSummary);
  const orphanStreamIds = streamStats
    .filter((stream) => !liveStreamIds.has(stream.streamId))
    .map((stream) => stream.streamId);

  return {
    scannedStreamStats: streamStats.length,
    streamStatOrphans: orphanStreamIds.length,
    orphanStreamIds,
  };
}

export async function ensureThreadByCreate<
  Component extends CodexThreadsCreateComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: EnsureThreadCreateArgs,
): Promise<FunctionReturnType<Component["threads"]["create"]>> {
  return ctx.runMutation(component.threads.create, {
    actor: args.actor,
    threadId: args.threadId,
    localThreadId: args.threadId,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
  });
}

export async function ensureThreadByResolve<
  Component extends CodexThreadsResolveComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: EnsureThreadResolveArgs,
): Promise<FunctionReturnType<Component["threads"]["resolve"]>> {
  return ctx.runMutation(component.threads.resolve, {
    actor: args.actor,
    ...(args.externalThreadId !== undefined ? { externalThreadId: args.externalThreadId } : {}),
    ...(args.externalThreadId !== undefined ? { localThreadId: args.externalThreadId } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
  });
}

export async function ensureSession<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: EnsureSessionArgs,
): Promise<FunctionReturnType<Component["sync"]["ensureSession"]>> {
  return ctx.runMutation(component.sync.ensureSession, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    lastEventCursor: args.lastEventCursor,
  });
}

export async function ingestEventStreamOnly<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: IngestEventStreamOnlyArgs,
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  const normalized = normalizeInboundDeltas([{ ...args.event, type: "stream_delta" }]);
  const event = normalized[0];
  if (!event) {
    throw new Error("Expected normalized stream_delta event.");
  }
  if (event.type !== "stream_delta") {
    throw new Error("Expected stream_delta event.");
  }
  return ctx.runMutation(component.sync.ingestSafe, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas: [event],
    lifecycleEvents: [],
  });
}

export async function ingestBatchStreamOnly<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: IngestBatchStreamOnlyArgs,
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  if (args.deltas.length === 0) {
    throw new Error("ingestBatch requires at least one delta");
  }
  const normalized = normalizeInboundDeltas(
    args.deltas.map((delta) => ({ ...delta, type: "stream_delta" })),
  );
  const streamDeltas = normalized.filter((delta): delta is HostInboundStreamDelta => delta.type === "stream_delta");
  return ctx.runMutation(component.sync.ingestSafe, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas,
    lifecycleEvents: [],
    ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
  });
}

export async function ingestEventMixed<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: IngestEventMixedArgs,
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  const normalized = normalizeInboundDeltas([args.event])[0];
  if (!normalized) {
    throw new Error("Expected normalized event.");
  }
  const streamDeltas = normalized.type === "stream_delta" ? [normalized] : [];
  const lifecycleEvents = normalized.type === "lifecycle_event" ? [normalized] : [];
  return ctx.runMutation(component.sync.ingestSafe, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas,
    lifecycleEvents,
  });
}

export async function ingestBatchMixed<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: IngestBatchMixedArgs,
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  if (args.deltas.length === 0) {
    throw new Error("ingestBatch requires at least one delta");
  }
  return ingestBatchSafe(ctx, component, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    deltas: args.deltas,
    ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
  });
}

export async function threadSnapshot<
  Component extends CodexThreadsStateComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ThreadSnapshotArgs,
): Promise<FunctionReturnType<Component["threads"]["getState"]>> {
  return ctx.runQuery(component.threads.getState, typedArgs<Component["threads"]["getState"]>(toThreadStateQueryArgs(args)));
}

function isThreadSnapshotSafeError(error: unknown): boolean {
  return isThreadMissing(error) || isThreadForbidden(error) || isSessionForbidden(error);
}

export async function threadSnapshotSafe<
  Component extends CodexThreadsStateComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ThreadSnapshotArgs,
): Promise<FunctionReturnType<Component["threads"]["getState"]> | null> {
  try {
    return await threadSnapshot(ctx, component, args);
  } catch (error) {
    if (isThreadSnapshotSafeError(error)) {
      return null;
    }
    throw error;
  }
}

export async function persistenceStats<
  Component extends CodexThreadsStateComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ThreadSnapshotArgs,
): Promise<{
  streamCount: number;
  deltaCount: number;
  latestCursorByStream: Array<{ streamId: string; cursor: number }>;
}> {
  const state = await threadSnapshot(ctx, component, args);
  return computePersistenceStats({ streamStats: getStreamStatsCandidate(state) });
}

export async function durableHistoryStats<
  Component extends CodexThreadsStateComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ThreadSnapshotArgs,
): Promise<{
  messageCountInPage: number;
  latest: DurableHistoryMessage[];
}> {
  const state = await threadSnapshot(ctx, component, args);
  return computeDurableHistoryStats({ recentMessages: getRecentMessagesCandidate(state) });
}

export async function dataHygiene<
  Component extends CodexThreadsStateComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ThreadSnapshotArgs,
): Promise<{
  scannedStreamStats: number;
  streamStatOrphans: number;
  orphanStreamIds: string[];
}> {
  const state = await threadSnapshot(ctx, component, args);
  return computeDataHygiene({
    streamStats: getStreamStatsCandidate(state),
    allStreams: getAllStreamsCandidate(state),
  });
}

// Re-export hook delegation functions from convexSliceHooks.ts
export {
  listThreadMessagesForHooksForActor,
  listThreadReasoningForHooksForActor,
  listTurnMessagesForHooksForActor,
  listPendingApprovalsForHooksForActor,
  respondApprovalForHooksForActor,
  listPendingServerRequestsForHooksForActor,
  upsertPendingServerRequestForHooksForActor,
  resolvePendingServerRequestForHooksForActor,
  upsertTokenUsageForActor,
  listTokenUsageForHooksForActor,
  interruptTurnForHooksForActor,
} from "./convexSliceHooks.js";
