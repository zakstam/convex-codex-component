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
import { classifyThreadReadError } from "../errors.js";

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

type CodexThreadsSyncBindingComponent = {
  threads: {
    syncOpenBinding?: FunctionReference<"mutation", "public" | "internal">;
    markSyncProgress?: FunctionReference<"mutation", "public" | "internal">;
    forceRebindSync?: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexThreadsSyncJobComponent = {
  threads: {
    startConversationSyncJob?: FunctionReference<"mutation", "public" | "internal">;
    appendConversationSyncChunk?: FunctionReference<"mutation", "public" | "internal">;
    sealConversationSyncJobSource?: FunctionReference<"mutation", "public" | "internal">;
    cancelConversationSyncJob?: FunctionReference<"mutation", "public" | "internal">;
    getConversationSyncJob?: FunctionReference<"query", "public" | "internal">;
    listConversationSyncJobs?: FunctionReference<"query", "public" | "internal">;
  };
};

type CodexThreadsResolveByConversationComponent = {
  threads: {
    resolveByConversationId?: FunctionReference<
      "query",
      "public" | "internal",
      {
        actor: HostActorContext;
        conversationId: string;
      },
      {
        conversationId: string;
        threadId: string;
      } | null
    >;
  };
};

type CodexThreadsConversationComponent = {
  threads: {
    listByConversation?: FunctionReference<"query", "public" | "internal">;
    archiveByConversation?: FunctionReference<"mutation", "public" | "internal">;
    unarchiveByConversation?: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexThreadsDeletionComponent = {
  threads: {
    deleteCascade: FunctionReference<"mutation", "public" | "internal">;
    scheduleDeleteCascade: FunctionReference<"mutation", "public" | "internal">;
    purgeActorData: FunctionReference<"mutation", "public" | "internal">;
    schedulePurgeActorData: FunctionReference<"mutation", "public" | "internal">;
    cancelScheduledDeletion: FunctionReference<"mutation", "public" | "internal">;
    forceRunScheduledDeletion: FunctionReference<"mutation", "public" | "internal">;
    getDeletionJobStatus: FunctionReference<"query", "public" | "internal">;
  };
};

type CodexTurnsComponent = {
  turns: {
    start: FunctionReference<"mutation", "public" | "internal">;
    interrupt: FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexTurnsDeletionComponent = {
  turns: {
    deleteCascade: FunctionReference<"mutation", "public" | "internal">;
    scheduleDeleteCascade: FunctionReference<"mutation", "public" | "internal">;
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
  & CodexThreadsSyncBindingComponent
  & CodexThreadsSyncJobComponent
  & CodexThreadsResolveByConversationComponent
  & CodexThreadsConversationComponent
  & CodexThreadsDeletionComponent
  & CodexTurnsComponent
  & CodexTurnsDeletionComponent
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
  conversationId: string;
  model?: string;
  cwd?: string;
};

type SyncOpenThreadBindingArgs = {
  actor: HostActorContext;
  runtimeConversationId: string;
  conversationId: string;
  model?: string;
  cwd?: string;
  sessionId?: string;
};

type MarkThreadSyncProgressArgs = {
  actor: HostActorContext;
  conversationId: string;
  runtimeConversationId?: string;
  sessionId?: string;
  cursor: number;
  syncState?: "unsynced" | "syncing" | "synced" | "drifted";
  errorCode?: string;
  syncJobId?: string;
  expectedSyncJobId?: string;
  syncJobState?: "idle" | "syncing" | "synced" | "failed" | "cancelled";
  syncJobPolicyVersion?: number;
  syncJobStartedAt?: number;
  syncJobUpdatedAt?: number;
  syncJobErrorCode?: string;
};

type ForceRebindThreadSyncArgs = {
  actor: HostActorContext;
  conversationId: string;
  runtimeConversationId: string;
  reasonCode?: string;
};

type StartConversationSyncJobArgs = {
  actor: HostActorContext;
  conversationId: string;
  runtimeConversationId?: string;
  threadId?: string;
  sourceChecksum?: string;
  expectedMessageCount?: number;
  expectedMessageIdsJson?: string;
};

type AppendConversationSyncChunkArgs = {
  actor: HostActorContext;
  jobId: string;
  chunkIndex: number;
  payloadJson: string;
  messageCount: number;
  byteSize: number;
};

type SealConversationSyncJobSourceArgs = {
  actor: HostActorContext;
  jobId: string;
};

type CancelConversationSyncJobArgs = {
  actor: HostActorContext;
  jobId: string;
  errorCode?: string;
  errorMessage?: string;
};

type GetConversationSyncJobArgs = {
  actor: HostActorContext;
  conversationId: string;
  jobId?: string;
};

type ListConversationSyncJobsArgs = {
  actor: HostActorContext;
  conversationId: string;
  limit?: number;
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

type ConversationLookupArgs = {
  actor: HostActorContext;
  conversationId: string;
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

function maybeThreadReadError(error: unknown): ReturnType<typeof classifyThreadReadError> {
  return classifyThreadReadError(error);
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

export async function ensureConversationBindingByCreate<
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

export async function ensureConversationBindingByResolve<
  Component extends CodexThreadsResolveComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: EnsureThreadResolveArgs,
): Promise<FunctionReturnType<Component["threads"]["resolve"]>> {
  return ctx.runMutation(component.threads.resolve, {
    actor: args.actor,
    conversationId: args.conversationId,
    localThreadId: args.conversationId,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
  });
}

export async function syncOpenConversationBindingForActor<
  Component extends CodexThreadsSyncBindingComponent & CodexThreadsResolveComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: SyncOpenThreadBindingArgs,
): Promise<{
  threadId: string;
  conversationId: string;
  runtimeConversationId: string;
  created: boolean;
  rebindApplied: boolean;
  syncState: "unsynced" | "syncing" | "synced" | "drifted";
}> {
  if (!component.threads.syncOpenBinding) {
    const resolved = await ctx.runMutation(component.threads.resolve, {
      actor: args.actor,
      conversationId: args.conversationId,
      localThreadId: args.runtimeConversationId,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    });
    const threadIdValue = typeof resolved === "object" && resolved !== null
      ? Reflect.get(resolved, "threadId")
      : null;
    const createdValue = typeof resolved === "object" && resolved !== null
      ? Reflect.get(resolved, "created")
      : null;
    if (typeof threadIdValue !== "string") {
      throw new Error("threads.resolve fallback returned invalid threadId.");
    }
    return {
      threadId: threadIdValue,
      conversationId: args.conversationId,
      runtimeConversationId: args.runtimeConversationId,
      created: createdValue === true,
      rebindApplied: false,
      syncState: "syncing",
    };
  }
  return ctx.runMutation(component.threads.syncOpenBinding, {
    actor: args.actor,
    runtimeConversationId: args.runtimeConversationId,
    conversationId: args.conversationId,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
  });
}

export async function markConversationSyncProgressForActor<
  Component extends CodexThreadsSyncBindingComponent & CodexThreadsResolveComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: MarkThreadSyncProgressArgs,
): Promise<{
  threadId: string;
  conversationId: string;
  runtimeConversationId?: string;
  syncState: "unsynced" | "syncing" | "synced" | "drifted";
  lastSyncedCursor: number;
  syncJobId?: string;
  syncJobState?: "idle" | "syncing" | "synced" | "failed" | "cancelled";
  syncJobPolicyVersion?: number;
  syncJobStartedAt?: number;
  syncJobUpdatedAt?: number;
  syncJobLastCursor?: number;
  syncJobErrorCode?: string;
  staleIgnored: boolean;
}> {
  if (!component.threads.markSyncProgress) {
    const resolved = await ctx.runMutation(component.threads.resolve, {
      actor: args.actor,
      conversationId: args.conversationId,
      ...(args.runtimeConversationId !== undefined ? { localThreadId: args.runtimeConversationId } : {}),
    });
    const threadIdValue = typeof resolved === "object" && resolved !== null
      ? Reflect.get(resolved, "threadId")
      : null;
    if (typeof threadIdValue !== "string") {
      throw new Error("threads.resolve fallback returned invalid threadId.");
    }
    return {
      threadId: threadIdValue,
      conversationId: args.conversationId,
      ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
      syncState: args.syncState === undefined ? "synced" : args.syncState,
      lastSyncedCursor: args.cursor,
      ...(args.syncJobId !== undefined ? { syncJobId: args.syncJobId } : {}),
      ...(args.syncJobState !== undefined ? { syncJobState: args.syncJobState } : {}),
      ...(args.syncJobPolicyVersion !== undefined ? { syncJobPolicyVersion: args.syncJobPolicyVersion } : {}),
      ...(args.syncJobStartedAt !== undefined ? { syncJobStartedAt: args.syncJobStartedAt } : {}),
      ...(args.syncJobUpdatedAt !== undefined ? { syncJobUpdatedAt: args.syncJobUpdatedAt } : {}),
      syncJobLastCursor: args.cursor,
      ...(args.syncJobErrorCode !== undefined ? { syncJobErrorCode: args.syncJobErrorCode } : {}),
      staleIgnored: false,
    };
  }
  return ctx.runMutation(component.threads.markSyncProgress, {
    actor: args.actor,
    conversationId: args.conversationId,
    ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
    ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
    cursor: args.cursor,
    ...(args.syncState !== undefined ? { syncState: args.syncState } : {}),
    ...(args.errorCode !== undefined ? { errorCode: args.errorCode } : {}),
    ...(args.syncJobId !== undefined ? { syncJobId: args.syncJobId } : {}),
    ...(args.expectedSyncJobId !== undefined ? { expectedSyncJobId: args.expectedSyncJobId } : {}),
    ...(args.syncJobState !== undefined ? { syncJobState: args.syncJobState } : {}),
    ...(args.syncJobPolicyVersion !== undefined ? { syncJobPolicyVersion: args.syncJobPolicyVersion } : {}),
    ...(args.syncJobStartedAt !== undefined ? { syncJobStartedAt: args.syncJobStartedAt } : {}),
    ...(args.syncJobUpdatedAt !== undefined ? { syncJobUpdatedAt: args.syncJobUpdatedAt } : {}),
    ...(args.syncJobErrorCode !== undefined ? { syncJobErrorCode: args.syncJobErrorCode } : {}),
  });
}

export async function forceRebindConversationSyncForActor<
  Component extends CodexThreadsSyncBindingComponent & CodexThreadsResolveComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: ForceRebindThreadSyncArgs,
): Promise<{
  threadId: string;
  conversationId: string;
  runtimeConversationId: string;
  syncState: "unsynced" | "syncing" | "synced" | "drifted";
  rebindCount: number;
}> {
  if (!component.threads.forceRebindSync) {
    const resolved = await ctx.runMutation(component.threads.resolve, {
      actor: args.actor,
      conversationId: args.conversationId,
      localThreadId: args.runtimeConversationId,
    });
    const threadIdValue = typeof resolved === "object" && resolved !== null
      ? Reflect.get(resolved, "threadId")
      : null;
    if (typeof threadIdValue !== "string") {
      throw new Error("threads.resolve fallback returned invalid threadId.");
    }
    return {
      threadId: threadIdValue,
      conversationId: args.conversationId,
      runtimeConversationId: args.runtimeConversationId,
      syncState: "syncing",
      rebindCount: 0,
    };
  }
  return ctx.runMutation(component.threads.forceRebindSync, {
    actor: args.actor,
    conversationId: args.conversationId,
    runtimeConversationId: args.runtimeConversationId,
    ...(args.reasonCode !== undefined ? { reasonCode: args.reasonCode } : {}),
  });
}

export async function startConversationSyncJobForActor<
  Component extends CodexThreadsSyncJobComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: StartConversationSyncJobArgs,
): Promise<{
  jobId: string;
  conversationId: string;
  threadId: string;
  state: "idle" | "syncing" | "synced" | "failed" | "cancelled";
  sourceState: "collecting" | "sealed" | "processing";
  policyVersion: number;
  startedAt: number;
  updatedAt: number;
}> {
  if (!component.threads.startConversationSyncJob) {
    throw new Error("Host component is missing threads.startConversationSyncJob.");
  }
  return ctx.runMutation(component.threads.startConversationSyncJob, {
    actor: args.actor,
    conversationId: args.conversationId,
    ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
    ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
    ...(args.sourceChecksum !== undefined ? { sourceChecksum: args.sourceChecksum } : {}),
    ...(args.expectedMessageCount !== undefined ? { expectedMessageCount: args.expectedMessageCount } : {}),
    ...(args.expectedMessageIdsJson !== undefined ? { expectedMessageIdsJson: args.expectedMessageIdsJson } : {}),
  });
}

export async function appendConversationSyncChunkForActor<
  Component extends CodexThreadsSyncJobComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: AppendConversationSyncChunkArgs,
): Promise<{
  jobId: string;
  chunkIndex: number;
  appended: boolean;
}> {
  if (!component.threads.appendConversationSyncChunk) {
    throw new Error("Host component is missing threads.appendConversationSyncChunk.");
  }
  return ctx.runMutation(component.threads.appendConversationSyncChunk, {
    actor: args.actor,
    jobId: args.jobId,
    chunkIndex: args.chunkIndex,
    payloadJson: args.payloadJson,
    messageCount: args.messageCount,
    byteSize: args.byteSize,
  });
}

export async function sealConversationSyncJobSourceForActor<
  Component extends CodexThreadsSyncJobComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: SealConversationSyncJobSourceArgs,
): Promise<{
  jobId: string;
  sourceState: "collecting" | "sealed" | "processing";
  totalChunks: number;
  scheduled: boolean;
}> {
  if (!component.threads.sealConversationSyncJobSource) {
    throw new Error("Host component is missing threads.sealConversationSyncJobSource.");
  }
  return ctx.runMutation(component.threads.sealConversationSyncJobSource, {
    actor: args.actor,
    jobId: args.jobId,
  });
}

export async function cancelConversationSyncJobForActor<
  Component extends CodexThreadsSyncJobComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: CancelConversationSyncJobArgs,
): Promise<{
  jobId: string;
  state: "idle" | "syncing" | "synced" | "failed" | "cancelled";
  cancelled: boolean;
}> {
  if (!component.threads.cancelConversationSyncJob) {
    throw new Error("Host component is missing threads.cancelConversationSyncJob.");
  }
  return ctx.runMutation(component.threads.cancelConversationSyncJob, {
    actor: args.actor,
    jobId: args.jobId,
    ...(args.errorCode !== undefined ? { errorCode: args.errorCode } : {}),
    ...(args.errorMessage !== undefined ? { errorMessage: args.errorMessage } : {}),
  });
}

export async function getConversationSyncJobForActor<
  Component extends CodexThreadsSyncJobComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: GetConversationSyncJobArgs,
): Promise<{
  jobId: string;
  conversationId: string;
  threadId: string;
  runtimeConversationId?: string;
  state: "idle" | "syncing" | "synced" | "failed" | "cancelled";
  sourceState: "collecting" | "sealed" | "processing";
  policyVersion: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  lastCursor: number;
  processedChunkIndex: number;
  totalChunks: number;
  processedMessageCount: number;
  retryCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
} | null> {
  if (!component.threads.getConversationSyncJob) {
    throw new Error("Host component is missing threads.getConversationSyncJob.");
  }
  return ctx.runQuery(component.threads.getConversationSyncJob, {
    actor: args.actor,
    conversationId: args.conversationId,
    ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
  });
}

export async function listConversationSyncJobsForActor<
  Component extends CodexThreadsSyncJobComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ListConversationSyncJobsArgs,
): Promise<Array<{
  jobId: string;
  state: "idle" | "syncing" | "synced" | "failed" | "cancelled";
  sourceState: "collecting" | "sealed" | "processing";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  retryCount: number;
  processedMessageCount: number;
  totalChunks: number;
  processedChunkIndex: number;
  lastErrorCode?: string;
}>> {
  if (!component.threads.listConversationSyncJobs) {
    throw new Error("Host component is missing threads.listConversationSyncJobs.");
  }
  return ctx.runQuery(component.threads.listConversationSyncJobs, {
    actor: args.actor,
    conversationId: args.conversationId,
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
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

export async function resolveThreadByConversationIdForActor<
  Component extends CodexThreadsResolveByConversationComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: ConversationLookupArgs,
): Promise<{
  conversationId: string;
  threadId: string;
} | null> {
  if (!component.threads.resolveByConversationId) {
    throw new Error(
      "Host component is missing threads.resolveByConversationId; this is required for conversation scoped APIs.",
    );
  }
  const resolveByConversationId = component.threads.resolveByConversationId;
  const resolved = await ctx.runQuery(
    resolveByConversationId,
    typedArgs<typeof resolveByConversationId>({
      actor: args.actor,
      conversationId: args.conversationId,
    }),
  );
  if (!resolved) {
    return null;
  }
  return {
    conversationId: resolved.conversationId,
    threadId: resolved.threadId,
  };
}

export function classifyThreadSnapshotError(
  error: unknown,
): ReturnType<typeof classifyThreadReadError> {
  return maybeThreadReadError(error);
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
