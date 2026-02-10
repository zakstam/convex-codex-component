import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import {
  getThreadState,
  interruptTurn,
  listPendingApprovals,
  listTurnMessages,
  respondToApproval,
  startTurn,
} from "../client/index.js";
import {
  ingestBatchSafe,
  listThreadMessagesForHooks,
  type HostInboundLifecycleEvent,
  type HostInboundStreamDelta,
  type HostMessagesForHooksArgs,
  type HostSyncRuntimeOptions,
} from "./convex.js";

type HostMutationRunner = {
  runMutation<Mutation extends FunctionReference<"mutation", "public" | "internal">>(
    mutation: Mutation,
    ...args: unknown[]
  ): Promise<FunctionReturnType<Mutation>>;
};

type HostQueryRunner = {
  runQuery<Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: unknown[]
  ): Promise<FunctionReturnType<Query>>;
};

export type HostActorContext = {
  tenantId: string;
  userId: string;
  deviceId: string;
};

export const vHostActorContext = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
});

export const vHostInboundEvent = v.object({
  eventId: v.string(),
  turnId: v.string(),
  streamId: v.string(),
  kind: v.string(),
  payloadJson: v.string(),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  createdAt: v.number(),
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
        v.literal("SESSION_DEVICE_MISMATCH"),
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

const TRUSTED_ACTOR = Object.freeze({
  tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
  deviceId: process.env.ACTOR_DEVICE_ID ?? "host-device",
});

export function trustedActorFromEnv(_actor: HostActorContext): HostActorContext {
  return TRUSTED_ACTOR;
}

type CodexThreadsCreateComponent = {
  threads: {
    create: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexThreadsResolveComponent = {
  threads: {
    resolve: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexTurnsComponent = {
  turns: {
    start: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
    interrupt: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexSyncComponent = {
  sync: {
    ensureSession: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
    ingestSafe: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
    replay: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexMessagesComponent = {
  messages: {
    listByThread: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    getByTurn: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexApprovalsComponent = {
  approvals: {
    listPending: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    respond: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexThreadsStateComponent = {
  threads: {
    getState: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type CodexHooksComponent = CodexMessagesComponent & CodexSyncComponent;

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

type RegisterTurnStartArgs = {
  actor: HostActorContext;
  threadId: string;
  turnId: string;
  inputText: string;
  idempotencyKey: string;
  model?: string;
  cwd?: string;
};

type EnsureSessionArgs = {
  actor: HostActorContext;
  sessionId: string;
  threadId: string;
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
};

type StreamStatSummary = {
  streamId: string;
  deltaCount: number;
  latestCursor: number;
};

function toThreadStateQueryArgs(args: ThreadSnapshotArgs): ThreadSnapshotArgs {
  return {
    actor: trustedActorFromEnv(args.actor),
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
    actor: trustedActorFromEnv(args.actor),
    threadId: args.threadId,
    localThreadId: args.threadId,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
  } as FunctionArgs<Component["threads"]["create"]>);
}

export async function ensureThreadByResolve<
  Component extends CodexThreadsResolveComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: EnsureThreadResolveArgs,
): Promise<FunctionReturnType<Component["threads"]["resolve"]>> {
  return ctx.runMutation(component.threads.resolve, {
    actor: trustedActorFromEnv(args.actor),
    ...(args.externalThreadId !== undefined ? { externalThreadId: args.externalThreadId } : {}),
    ...(args.externalThreadId !== undefined ? { localThreadId: args.externalThreadId } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
  } as FunctionArgs<Component["threads"]["resolve"]>);
}

export async function registerTurnStart<
  Component extends CodexTurnsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: RegisterTurnStartArgs,
): Promise<FunctionReturnType<Component["turns"]["start"]>> {
  return startTurn(ctx, component, {
    actor: trustedActorFromEnv(args.actor),
    threadId: args.threadId,
    turnId: args.turnId,
    idempotencyKey: args.idempotencyKey,
    input: [{ type: "text", text: args.inputText }],
    ...(args.model !== undefined || args.cwd !== undefined
      ? {
          options: {
            ...(args.model !== undefined ? { model: args.model } : {}),
            ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
          },
        }
      : {}),
  } as FunctionArgs<Component["turns"]["start"]>);
}

export async function ensureSession<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: EnsureSessionArgs,
): Promise<FunctionReturnType<Component["sync"]["ensureSession"]>> {
  return ctx.runMutation(component.sync.ensureSession, {
    actor: trustedActorFromEnv(args.actor),
    sessionId: args.sessionId,
    threadId: args.threadId,
    lastEventCursor: 0,
  } as FunctionArgs<Component["sync"]["ensureSession"]>);
}

export async function ingestEventStreamOnly<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: IngestEventStreamOnlyArgs,
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  return ctx.runMutation(component.sync.ingestSafe, {
    actor: trustedActorFromEnv(args.actor),
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas: [{ ...args.event, type: "stream_delta" as const }],
    lifecycleEvents: [],
  } as FunctionArgs<Component["sync"]["ingestSafe"]>);
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
  return ctx.runMutation(component.sync.ingestSafe, {
    actor: trustedActorFromEnv(args.actor),
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas: args.deltas.map((delta) => ({ ...delta, type: "stream_delta" as const })),
    lifecycleEvents: [],
    ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
  } as FunctionArgs<Component["sync"]["ingestSafe"]>);
}

export async function ingestEventMixed<
  Component extends CodexSyncComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: IngestEventMixedArgs,
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  const streamDeltas = args.event.type === "stream_delta" ? [args.event] : [];
  const lifecycleEvents = args.event.type === "lifecycle_event" ? [args.event] : [];
  return ctx.runMutation(component.sync.ingestSafe, {
    actor: trustedActorFromEnv(args.actor),
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas,
    lifecycleEvents,
  } as FunctionArgs<Component["sync"]["ingestSafe"]>);
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
    actor: trustedActorFromEnv(args.actor),
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
  return getThreadState(ctx, component, toThreadStateQueryArgs(args) as FunctionArgs<Component["threads"]["getState"]>);
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
  return computePersistenceStats(state as { streamStats?: unknown[] | null });
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
  return computeDurableHistoryStats(state as { recentMessages?: DurableHistoryMessage[] | null });
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
  return computeDataHygiene(
    state as {
      streamStats?: unknown[] | null;
      allStreams?: Array<{ streamId: string }> | null;
    },
  );
}

export async function listThreadMessagesForHooksWithTrustedActor<
  Component extends CodexHooksComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: HostMessagesForHooksArgs<HostActorContext>,
): Promise<
  FunctionReturnType<Component["messages"]["listByThread"]> & {
    streams?:
      | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
      | {
          kind: "deltas";
          streams: Array<{ streamId: string; state: string }>;
          deltas: Array<Record<string, unknown>>;
          streamWindows: Array<{
            streamId: string;
            status: "ok" | "rebased" | "stale";
            serverCursorStart: number;
            serverCursorEnd: number;
          }>;
          nextCheckpoints: Array<{ streamId: string; cursor: number }>;
        };
  }
> {
  return listThreadMessagesForHooks(ctx, component, {
    ...args,
    actor: trustedActorFromEnv(args.actor),
  });
}

export async function listTurnMessagesForHooksWithTrustedActor<
  Component extends CodexMessagesComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    threadId: string;
    turnId: string;
  },
): Promise<FunctionReturnType<Component["messages"]["getByTurn"]>> {
  return listTurnMessages(ctx, component, {
    ...args,
    actor: trustedActorFromEnv(args.actor),
  } as FunctionArgs<Component["messages"]["getByTurn"]>);
}

export async function listPendingApprovalsForHooksWithTrustedActor<
  Component extends CodexApprovalsComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    threadId?: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
): Promise<FunctionReturnType<Component["approvals"]["listPending"]>> {
  return listPendingApprovals(ctx, component, {
    ...args,
    actor: trustedActorFromEnv(args.actor),
  } as FunctionArgs<Component["approvals"]["listPending"]>);
}

export async function respondApprovalForHooksWithTrustedActor<
  Component extends CodexApprovalsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    threadId: string;
    turnId: string;
    itemId: string;
    decision: "accepted" | "declined";
  },
): Promise<FunctionReturnType<Component["approvals"]["respond"]>> {
  return respondToApproval(ctx, component, {
    ...args,
    actor: trustedActorFromEnv(args.actor),
  } as FunctionArgs<Component["approvals"]["respond"]>);
}

export async function interruptTurnForHooksWithTrustedActor<
  Component extends CodexTurnsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    threadId: string;
    turnId: string;
    reason?: string;
  },
): Promise<FunctionReturnType<Component["turns"]["interrupt"]>> {
  return interruptTurn(ctx, component, {
    ...args,
    actor: trustedActorFromEnv(args.actor),
  } as FunctionArgs<Component["turns"]["interrupt"]>);
}
