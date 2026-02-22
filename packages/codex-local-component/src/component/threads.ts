import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { now, requireThreadForActor, requireThreadRefForActor } from "./utils.js";
import { STREAM_DRAIN_COMPLETE_KIND } from "../shared/streamLifecycle.js";
import { identifyStaleStreamingStatIds } from "./streamStats.js";
import { loadThreadSnapshotRows } from "./repositories/threadSnapshotRepo.js";
import {
  generateUuidV4,
  clampDeleteDelayMs,
  parseDeletedCountsToArray,
} from "./deletionUtils.js";
import { vThreadState, vDeletionJobStatus } from "./threadValidators.js";
import { touchThread, getDeletionJobForActor } from "./threadHelpers.js";
import { deriveThreadPreview } from "./threadPreview.js";
import { ingestSafeHandler, type InboundEvent } from "./syncIngest.js";

const vThreadIdentity = v.object({
  threadId: v.string(),
});

const vSyncState = v.union(
  v.literal("unsynced"),
  v.literal("syncing"),
  v.literal("synced"),
  v.literal("drifted"),
);
type SyncState = "unsynced" | "syncing" | "synced" | "drifted";

const vSyncJobState = v.union(
  v.literal("idle"),
  v.literal("syncing"),
  v.literal("synced"),
  v.literal("failed"),
  v.literal("cancelled"),
);
type SyncJobState = "idle" | "syncing" | "synced" | "failed" | "cancelled";
type SyncJobSourceState = "collecting" | "sealed" | "processing";

const SYNC_JOB_POLICY_VERSION = 3;
const SYNC_JOB_RETRY_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 16000, 16000, 16000];
const SYNC_JOB_MAX_RETRY_ATTEMPTS = 8;
const SYNC_JOB_SUB_BATCH_MAX_DELTAS = 48;

const vResumeResult = v.object({
  threadId: v.string(),
  status: v.literal("active"),
});

const vThreadListResult = v.object({
  page: v.array(
    v.object({
      conversationId: v.string(),
      status: v.union(v.literal("active"), v.literal("archived"), v.literal("failed")),
      updatedAt: v.number(),
      preview: v.string(),
    }),
  ),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

async function requireThreadBindingByConversation(
  ctx: MutationCtx,
  args: { actor: { userId?: string }; conversationId: string },
) {
  const binding = await ctx.db
    .query("codex_thread_bindings")
    .withIndex("userScope_userId_conversationId", (q) =>
      q
        .eq("userScope", userScopeFromActor(args.actor))
        .eq("userId", args.actor.userId)
        .eq("conversationId", args.conversationId),
    )
    .first();
  if (!binding) {
    throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
  }
  return binding;
}

function buildSyncActorFromJob(job: {
  userId?: string;
}): { userId?: string } {
  return job.userId !== undefined ? { userId: String(job.userId) } : {};
}

function parseChunkPayload(payloadJson: string): InboundEvent[] {
  const parsed = JSON.parse(payloadJson) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("[E_SYNC_JOB_CHUNK_PAYLOAD_INVALID] Chunk payload must be an array.");
  }
  return parsed as InboundEvent[];
}

function normalizeSyncMessageItemType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function isCanonicalRenderableMessageType(itemType: string): boolean {
  return (
    itemType === "usermessage" ||
    itemType === "user_message" ||
    itemType === "assistantmessage" ||
    itemType === "assistant_message" ||
    itemType === "agentmessage" ||
    itemType === "agent_message" ||
    itemType === "systemmessage" ||
    itemType === "system_message" ||
    itemType === "toolmessage" ||
    itemType === "tool_message"
  );
}

type SyncManifestEntry = { turnId: string; messageId: string };

function extractCanonicalMessageManifestFromEvents(events: InboundEvent[]): SyncManifestEntry[] {
  const entries: SyncManifestEntry[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "stream_delta" || event.kind !== "item/completed") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.payloadJson);
    } catch (_error) {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const params = (parsed as { params?: unknown }).params;
    if (typeof params !== "object" || params === null) {
      continue;
    }
    const item = (params as { item?: unknown }).item;
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const messageId = (item as { id?: unknown }).id;
    const turnId = (params as { turnId?: unknown }).turnId;
    const itemType = normalizeSyncMessageItemType((item as { type?: unknown }).type);
    if (
      typeof messageId !== "string" ||
      typeof turnId !== "string" ||
      !itemType ||
      !isCanonicalRenderableMessageType(itemType)
    ) {
      continue;
    }
    const key = JSON.stringify([turnId, messageId]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ turnId, messageId });
  }
  return entries;
}

function parseExpectedMessageIdsJson(payload: unknown): SyncManifestEntry[] {
  if (typeof payload !== "string") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (_error) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: SyncManifestEntry[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const turnId = (value as { turnId?: unknown }).turnId;
    const messageId = (value as { messageId?: unknown }).messageId;
    if (typeof turnId !== "string" || typeof messageId !== "string") {
      continue;
    }
    const key = JSON.stringify([turnId, messageId]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ turnId, messageId });
  }
  return entries;
}

function splitInboundEvents(events: InboundEvent[]): {
  streamDeltas: Array<Extract<InboundEvent, { type: "stream_delta" }>>;
  lifecycleEvents: Array<Extract<InboundEvent, { type: "lifecycle_event" }>>;
} {
  const streamDeltas: Array<Extract<InboundEvent, { type: "stream_delta" }>> = [];
  const lifecycleEvents: Array<Extract<InboundEvent, { type: "lifecycle_event" }>> = [];
  for (const event of events) {
    if (event.type === "stream_delta") {
      streamDeltas.push(event);
      continue;
    }
    lifecycleEvents.push(event);
  }
  return { streamDeltas, lifecycleEvents };
}

async function processSyncEventsWithAdaptiveSplit(
  ctx: MutationCtx,
  args: {
    actor: { userId?: string };
    sessionId: string;
    threadId: string;
    events: InboundEvent[];
  },
): Promise<{ ok: true; maxEventCursor: number } | { ok: false; errorCode: string; errorMessage: string }> {
  const queue: InboundEvent[][] = [];
  for (let offset = 0; offset < args.events.length; offset += SYNC_JOB_SUB_BATCH_MAX_DELTAS) {
    queue.push(args.events.slice(offset, offset + SYNC_JOB_SUB_BATCH_MAX_DELTAS));
  }

  let maxEventCursor = 0;
  while (queue.length > 0) {
    const batch = queue.shift();
    if (!batch || batch.length === 0) {
      continue;
    }
    const { streamDeltas, lifecycleEvents } = splitInboundEvents(batch);
    const ingest = await ingestSafeHandler(ctx, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas,
      lifecycleEvents,
    });
    if (ingest.status !== "rejected") {
      for (const acked of ingest.ackedStreams) {
        maxEventCursor = Math.max(maxEventCursor, acked.ackCursorEnd);
      }
      continue;
    }
    if (batch.length > 1) {
      const splitAt = Math.max(1, Math.floor(batch.length / 2));
      queue.unshift(batch.slice(splitAt));
      queue.unshift(batch.slice(0, splitAt));
      continue;
    }
    const firstError = ingest.errors[0];
    return {
      ok: false,
      errorCode: firstError ? String(firstError.code) : "UNKNOWN",
      errorMessage: firstError ? String(firstError.message) : "Conversation sync ingest rejected.",
    };
  }
  return { ok: true, maxEventCursor };
}

export const create = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    localThreadId: v.optional(v.string()),
  },
  returns: vThreadIdentity,
  handler: async (ctx, args) => {
    const touched = await touchThread(ctx, args);
    return { threadId: touched.threadId };
  },
});

export const resolve = mutation({
  args: {
    actor: vActorContext,
    conversationId: v.optional(v.string()),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    localThreadId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    conversationId: v.optional(v.string()),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ts = now();
    const conversationId = args.conversationId;

    if (conversationId !== undefined) {
      const binding = await ctx.db
        .query("codex_thread_bindings")
        .withIndex("userScope_userId_conversationId", (q) =>
          q
            .eq("userScope", userScopeFromActor(args.actor))
            .eq("userId", args.actor.userId)
            .eq("conversationId", conversationId),
        )
        .first();

      if (binding) {
        const touched = await touchThread(ctx, {
          actor: args.actor,
          threadId: String(binding.threadId),
          ...(args.model !== undefined ? { model: args.model } : {}),
          ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
          ...(args.personality !== undefined ? { personality: args.personality } : {}),
          ...(args.localThreadId !== undefined ? { localThreadId: args.localThreadId } : {}),
        });

        await ctx.db.patch(binding._id, {
          conversationId,
          conversationRef: touched.threadRef,
          runtimeConversationId: conversationId,
          syncState: "syncing",
          lastErrorCode: undefined,
          lastErrorAt: undefined,
          updatedAt: ts,
        });

        return {
          threadId: touched.threadId,
          conversationId,
          created: false,
        };
      }
    }

    const newThreadId = generateUuidV4();
    const touched = await touchThread(ctx, {
      actor: args.actor,
      threadId: newThreadId,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
      ...(args.personality !== undefined ? { personality: args.personality } : {}),
      ...(args.localThreadId !== undefined ? { localThreadId: args.localThreadId } : {}),
    });

    if (conversationId !== undefined) {
      await ctx.db.insert("codex_thread_bindings", {
        userScope: userScopeFromActor(args.actor),
        ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
        conversationId,
        runtimeConversationId: conversationId,
        threadId: touched.threadId,
        conversationRef: touched.threadRef,
        syncState: "syncing",
        rebindCount: 0,
        createdAt: ts,
        updatedAt: ts,
      });
    }

    return {
      threadId: touched.threadId,
      ...(conversationId !== undefined ? { conversationId } : {}),
      created: true,
    };
  },
});

export const resolveByConversationId = query({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      conversationId: v.string(),
      threadId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("userId", args.actor.userId)
          .eq("conversationId", args.conversationId),
      )
      .first();

    if (!binding) {
      return null;
    }

    return {
      conversationId: String(binding.conversationId),
      threadId: String(binding.threadId),
    };
  },
});

export const listByConversation = query({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  returns: vThreadListResult,
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("userId", args.actor.userId)
          .eq("conversationId", args.conversationId),
      )
      .first();
    if (!binding) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const thread = await requireThreadForActor(ctx, args.actor, String(binding.threadId));
    if (args.includeArchived !== true && thread.status === "archived") {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const threadId = String(thread.threadId);
    const [lifecycleEvents, earliestMessages] = await Promise.all([
      ctx.db
        .query("codex_lifecycle_events")
        .withIndex("userScope_threadId_createdAt", (q) =>
          q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", threadId),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("codex_messages")
        .withIndex("userScope_threadId_createdAt", (q) =>
          q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", threadId),
        )
        .order("asc")
        .take(30),
    ]);
    const firstUserMessage = earliestMessages.find((message) => message.role === "user");
    const preview = deriveThreadPreview({
      lifecycleEvents: lifecycleEvents.map((event) => ({
        kind: String(event.kind),
        payloadJson: String(event.payloadJson),
      })),
      firstUserMessageText: firstUserMessage ? String(firstUserMessage.text) : null,
    });
    return {
      page: [{
        conversationId: String(binding.conversationId),
        status: thread.status,
        updatedAt: Number(thread.updatedAt),
        preview,
      }],
      isDone: true,
      continueCursor: "",
    };
  },
});

export const listRuntimeConversationBindings = query({
  args: {
    actor: vActorContext,
    runtimeConversationIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      runtimeConversationId: v.string(),
      threadId: v.string(),
      conversationId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const seen = new Set<string>();
    const out: Array<{ runtimeConversationId: string; threadId: string; conversationId: string }> = [];

    for (const runtimeConversationId of args.runtimeConversationIds) {
      if (seen.has(runtimeConversationId)) {
        continue;
      }
      seen.add(runtimeConversationId);
      const binding = await ctx.db
        .query("codex_thread_bindings")
        .withIndex("userScope_userId_runtimeConversationId", (q) =>
          q
            .eq("userScope", userScope)
            .eq("userId", args.actor.userId)
            .eq("runtimeConversationId", runtimeConversationId),
        )
        .first();
      if (!binding) {
        continue;
      }
      out.push({
        runtimeConversationId,
        threadId: String(binding.threadId),
        conversationId: String(binding.conversationId),
      });
    }

    return out;
  },
});

export const resume = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: vResumeResult,
  handler: async (ctx, args) => {
    const thread = await requireThreadForActor(ctx, args.actor, args.threadId);
    await ctx.db.patch(thread._id, {
      status: "active",
      updatedAt: now(),
    });
    return { threadId: String(thread.threadId), status: "active" as const };
  },
});

export const archiveByConversation = mutation({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    threadId: v.string(),
  },
  returns: v.object({
    conversationId: v.string(),
    threadId: v.string(),
    status: v.literal("archived"),
  }),
  handler: async (ctx, args) => {
    const binding = await requireThreadBindingByConversation(ctx, args);
    if (String(binding.threadId) !== args.threadId) {
      throw new Error(`[E_CONVERSATION_THREAD_MISMATCH] Conversation ${args.conversationId} is not bound to thread ${args.threadId}`);
    }
    const { thread } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    await ctx.db.patch(thread._id, {
      status: "archived",
      updatedAt: now(),
    });
    return {
      conversationId: args.conversationId,
      threadId: args.threadId,
      status: "archived" as const,
    };
  },
});

export const unarchiveByConversation = mutation({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    threadId: v.string(),
  },
  returns: v.object({
    conversationId: v.string(),
    threadId: v.string(),
    status: v.literal("active"),
  }),
  handler: async (ctx, args) => {
    const binding = await requireThreadBindingByConversation(ctx, args);
    if (String(binding.threadId) !== args.threadId) {
      throw new Error(`[E_CONVERSATION_THREAD_MISMATCH] Conversation ${args.conversationId} is not bound to thread ${args.threadId}`);
    }
    const { thread } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    await ctx.db.patch(thread._id, {
      status: "active",
      updatedAt: now(),
    });
    return {
      conversationId: args.conversationId,
      threadId: args.threadId,
      status: "active" as const,
    };
  },
});

export const syncOpenBinding = mutation({
  args: {
    actor: vActorContext,
    runtimeConversationId: v.string(),
    conversationId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    conversationId: v.string(),
    runtimeConversationId: v.string(),
    created: v.boolean(),
    rebindApplied: v.boolean(),
    syncState: vSyncState,
  }),
  handler: async (ctx, args) => {
    const ts = now();
    const conversationId = args.conversationId;
    const userScope = userScopeFromActor(args.actor);

    const existing = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q.eq("userScope", userScope).eq("userId", args.actor.userId).eq("conversationId", conversationId),
      )
      .first();

    if (existing) {
      const touched = await touchThread(ctx, {
        actor: args.actor,
        threadId: String(existing.threadId),
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
        localThreadId: args.runtimeConversationId,
      });
      const rebindApplied = existing.runtimeConversationId !== args.runtimeConversationId;
      const syncState: SyncState = "syncing";
      await ctx.db.patch(existing._id, {
        conversationId,
        conversationRef: touched.threadRef,
        runtimeConversationId: args.runtimeConversationId,
        syncState,
        syncJobState: "idle",
        syncJobUpdatedAt: ts,
        ...(args.sessionId !== undefined ? { lastSessionId: args.sessionId } : {}),
        ...(rebindApplied ? { rebindCount: Number(existing.rebindCount ?? 0) + 1 } : {}),
        lastErrorCode: undefined,
        lastErrorAt: undefined,
        updatedAt: ts,
      });
      return {
        threadId: touched.threadId,
        conversationId,
        runtimeConversationId: args.runtimeConversationId,
        created: false,
        rebindApplied,
        syncState,
      };
    }

    const newThreadId = generateUuidV4();
    const touched = await touchThread(ctx, {
      actor: args.actor,
      threadId: newThreadId,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
      localThreadId: args.runtimeConversationId,
    });

    const syncState: SyncState = "syncing";
    await ctx.db.insert("codex_thread_bindings", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      conversationId,
      runtimeConversationId: args.runtimeConversationId,
      threadId: touched.threadId,
      conversationRef: touched.threadRef,
      syncState,
      syncJobState: "idle",
      syncJobUpdatedAt: ts,
      ...(args.sessionId !== undefined ? { lastSessionId: args.sessionId } : {}),
      rebindCount: 0,
      lastSyncedCursor: 0,
      createdAt: ts,
      updatedAt: ts,
    });

    return {
      threadId: touched.threadId,
      conversationId,
      runtimeConversationId: args.runtimeConversationId,
      created: true,
      rebindApplied: false,
      syncState,
    };
  },
});

export const markSyncProgress = mutation({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    runtimeConversationId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    cursor: v.number(),
    syncState: v.optional(vSyncState),
    errorCode: v.optional(v.string()),
    syncJobId: v.optional(v.string()),
    expectedSyncJobId: v.optional(v.string()),
    syncJobState: v.optional(vSyncJobState),
    syncJobPolicyVersion: v.optional(v.number()),
    syncJobStartedAt: v.optional(v.number()),
    syncJobUpdatedAt: v.optional(v.number()),
    syncJobErrorCode: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    conversationId: v.string(),
    runtimeConversationId: v.optional(v.string()),
    syncState: vSyncState,
    lastSyncedCursor: v.number(),
    syncJobId: v.optional(v.string()),
    syncJobState: v.optional(vSyncJobState),
    syncJobPolicyVersion: v.optional(v.number()),
    syncJobStartedAt: v.optional(v.number()),
    syncJobUpdatedAt: v.optional(v.number()),
    syncJobLastCursor: v.optional(v.number()),
    syncJobErrorCode: v.optional(v.string()),
    staleIgnored: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("userId", args.actor.userId)
          .eq("conversationId", args.conversationId),
      )
      .first();

    if (!binding) {
      throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
    }

    const nextState: SyncState = args.syncState ?? "synced";
    const ts = now();
    const currentSyncJobId = binding.syncJobId !== undefined ? String(binding.syncJobId) : undefined;
    const expectedSyncJobId = args.expectedSyncJobId !== undefined ? String(args.expectedSyncJobId) : undefined;
    if (
      expectedSyncJobId !== undefined &&
      expectedSyncJobId !== currentSyncJobId
    ) {
      return {
        threadId: String(binding.threadId),
        conversationId: String(binding.conversationId),
        ...(binding.runtimeConversationId !== undefined
          ? { runtimeConversationId: String(binding.runtimeConversationId) }
          : {}),
        syncState: (binding.syncState ?? "unsynced") as SyncState,
        lastSyncedCursor: Number(binding.lastSyncedCursor ?? 0),
        ...(currentSyncJobId !== undefined ? { syncJobId: currentSyncJobId } : {}),
        ...(binding.syncJobState !== undefined ? { syncJobState: binding.syncJobState as SyncJobState } : {}),
        ...(binding.syncJobPolicyVersion !== undefined ? { syncJobPolicyVersion: Number(binding.syncJobPolicyVersion) } : {}),
        ...(binding.syncJobStartedAt !== undefined ? { syncJobStartedAt: Number(binding.syncJobStartedAt) } : {}),
        ...(binding.syncJobUpdatedAt !== undefined ? { syncJobUpdatedAt: Number(binding.syncJobUpdatedAt) } : {}),
        ...(binding.syncJobLastCursor !== undefined ? { syncJobLastCursor: Number(binding.syncJobLastCursor) } : {}),
        ...(binding.syncJobErrorCode !== undefined ? { syncJobErrorCode: String(binding.syncJobErrorCode) } : {}),
        staleIgnored: true,
      };
    }

    await ctx.db.patch(binding._id, {
      ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
      ...(args.sessionId !== undefined ? { lastSessionId: args.sessionId } : {}),
      lastSyncedCursor: args.cursor,
      syncState: nextState,
      ...(args.errorCode !== undefined ? { lastErrorCode: args.errorCode, lastErrorAt: ts } : { lastErrorCode: undefined, lastErrorAt: undefined }),
      ...(args.syncJobId !== undefined ? { syncJobId: args.syncJobId } : {}),
      ...(args.syncJobState !== undefined ? { syncJobState: args.syncJobState } : {}),
      ...(args.syncJobPolicyVersion !== undefined ? { syncJobPolicyVersion: args.syncJobPolicyVersion } : {}),
      ...(args.syncJobStartedAt !== undefined ? { syncJobStartedAt: args.syncJobStartedAt } : {}),
      syncJobUpdatedAt: args.syncJobUpdatedAt ?? ts,
      syncJobLastCursor: args.cursor,
      ...(args.syncJobErrorCode !== undefined ? { syncJobErrorCode: args.syncJobErrorCode } : { syncJobErrorCode: undefined }),
      updatedAt: ts,
    });

    return {
      threadId: String(binding.threadId),
      conversationId: String(binding.conversationId),
      ...(args.runtimeConversationId !== undefined
        ? { runtimeConversationId: args.runtimeConversationId }
        : binding.runtimeConversationId !== undefined
          ? { runtimeConversationId: String(binding.runtimeConversationId) }
          : {}),
      syncState: nextState,
      lastSyncedCursor: args.cursor,
      ...(args.syncJobId !== undefined
        ? { syncJobId: args.syncJobId }
        : currentSyncJobId !== undefined
          ? { syncJobId: currentSyncJobId }
          : {}),
      ...(args.syncJobState !== undefined
        ? { syncJobState: args.syncJobState }
        : binding.syncJobState !== undefined
          ? { syncJobState: binding.syncJobState as SyncJobState }
          : {}),
      ...(args.syncJobPolicyVersion !== undefined
        ? { syncJobPolicyVersion: args.syncJobPolicyVersion }
        : binding.syncJobPolicyVersion !== undefined
          ? { syncJobPolicyVersion: Number(binding.syncJobPolicyVersion) }
          : {}),
      ...(args.syncJobStartedAt !== undefined
        ? { syncJobStartedAt: args.syncJobStartedAt }
        : binding.syncJobStartedAt !== undefined
          ? { syncJobStartedAt: Number(binding.syncJobStartedAt) }
          : {}),
      syncJobUpdatedAt: args.syncJobUpdatedAt ?? ts,
      syncJobLastCursor: args.cursor,
      ...(args.syncJobErrorCode !== undefined
        ? { syncJobErrorCode: args.syncJobErrorCode }
        : binding.syncJobErrorCode !== undefined
          ? { syncJobErrorCode: String(binding.syncJobErrorCode) }
          : {}),
      staleIgnored: false,
    };
  },
});

export const forceRebindSync = mutation({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    runtimeConversationId: v.string(),
    reasonCode: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    conversationId: v.string(),
    runtimeConversationId: v.string(),
    syncState: vSyncState,
    rebindCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("userId", args.actor.userId)
          .eq("conversationId", args.conversationId),
      )
      .first();
    if (!binding) {
      throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
    }
    const ts = now();
    const rebindCount = Number(binding.rebindCount ?? 0) + 1;
    const syncState: SyncState = "syncing";
    await ctx.db.patch(binding._id, {
      runtimeConversationId: args.runtimeConversationId,
      syncState,
      rebindCount,
      ...(args.reasonCode !== undefined ? { lastErrorCode: args.reasonCode, lastErrorAt: ts } : {}),
      updatedAt: ts,
    });
    return {
      threadId: String(binding.threadId),
      conversationId: String(binding.conversationId),
      runtimeConversationId: args.runtimeConversationId,
      syncState,
      rebindCount,
    };
  },
});

export const startConversationSyncJob = mutation({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    runtimeConversationId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    sourceChecksum: v.optional(v.string()),
    expectedMessageCount: v.optional(v.number()),
    expectedMessageIdsJson: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.string(),
    conversationId: v.string(),
    threadId: v.string(),
    state: vSyncJobState,
    sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("processing")),
    policyVersion: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q.eq("userScope", userScope).eq("userId", args.actor.userId).eq("conversationId", args.conversationId),
      )
      .first();
    if (!binding && args.threadId === undefined) {
      throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
    }
    const threadId = args.threadId ?? String(binding!.threadId);

    const activeJobs = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_userId_conversationId_startedAt", (q) =>
        q.eq("userScope", userScope).eq("userId", args.actor.userId).eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(8);
    for (const job of activeJobs) {
      if (job.state === "syncing" || job.sourceState === "collecting") {
        await ctx.db.patch(job._id, {
          state: "cancelled",
          sourceState: "collecting" as SyncJobSourceState,
          completedAt: ts,
          updatedAt: ts,
          lastErrorCode: "E_SYNC_JOB_CANCELLED_REPLACED",
          lastErrorMessage: "Cancelled because a newer sync job was started.",
        });
      }
    }

    const jobId = generateUuidV4();
    const jobRef = await ctx.db.insert("codex_sync_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      conversationId: args.conversationId,
      threadId,
      ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
      jobId,
      policyVersion: SYNC_JOB_POLICY_VERSION,
      state: "syncing",
      startedAt: ts,
      updatedAt: ts,
      lastCursor: 0,
      processedChunkIndex: 0,
      totalChunks: 0,
      processedMessageCount: 0,
      ...(args.expectedMessageCount !== undefined ? { expectedMessageCount: args.expectedMessageCount } : {}),
      ...(args.expectedMessageIdsJson !== undefined ? { expectedMessageIdsJson: args.expectedMessageIdsJson } : {}),
      retryCount: 0,
      sourceState: "collecting",
      ...(args.sourceChecksum !== undefined ? { sourceChecksum: args.sourceChecksum } : {}),
    });
    if (binding) {
      await ctx.db.patch(binding._id, {
        syncState: "syncing",
        syncJobId: jobId,
        syncJobState: "syncing",
        syncJobPolicyVersion: SYNC_JOB_POLICY_VERSION,
        syncJobStartedAt: ts,
        syncJobUpdatedAt: ts,
        syncJobErrorCode: undefined,
        ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
        updatedAt: ts,
      });
    } else {
      await ctx.db.insert("codex_thread_bindings", {
        userScope,
        ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
        conversationId: args.conversationId,
        ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
        threadId,
        conversationRef: (await requireThreadRefForActor(ctx, args.actor, threadId)).threadRef,
        syncState: "syncing",
        syncJobId: jobId,
        syncJobState: "syncing",
        syncJobPolicyVersion: SYNC_JOB_POLICY_VERSION,
        syncJobStartedAt: ts,
        syncJobUpdatedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    const created = await ctx.db.get(jobRef);
    if (!created) {
      throw new Error("[E_SYNC_JOB_CREATE_FAILED] Failed to create sync job.");
    }
    return {
      jobId: String(created.jobId),
      conversationId: String(created.conversationId),
      threadId: String(created.threadId),
      state: created.state as SyncJobState,
      sourceState: created.sourceState as SyncJobSourceState,
      policyVersion: Number(created.policyVersion),
      startedAt: Number(created.startedAt),
      updatedAt: Number(created.updatedAt),
    };
  },
});

export const appendConversationSyncChunk = mutation({
  args: {
    actor: vActorContext,
    jobId: v.string(),
    chunkIndex: v.number(),
    payloadJson: v.string(),
    messageCount: v.number(),
    byteSize: v.number(),
  },
  returns: v.object({
    jobId: v.string(),
    chunkIndex: v.number(),
    appended: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const job = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_jobId", (q) => q.eq("userScope", userScope).eq("jobId", args.jobId))
      .first();
    if (!job) {
      throw new Error(`[E_SYNC_JOB_NOT_FOUND] Sync job not found: ${args.jobId}`);
    }
    if (job.sourceState !== "collecting") {
      throw new Error(`[E_SYNC_JOB_SOURCE_NOT_COLLECTING] Sync job ${args.jobId} source is not collecting.`);
    }
    const existing = await ctx.db
      .query("codex_sync_job_chunks")
      .withIndex("userScope_jobRef_chunkIndex", (q) =>
        q.eq("userScope", userScope).eq("jobRef", job._id).eq("chunkIndex", args.chunkIndex),
      )
      .first();
    const ts = now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        payloadJson: args.payloadJson,
        messageCount: args.messageCount,
        byteSize: args.byteSize,
      });
      await ctx.db.patch(job._id, { updatedAt: ts });
      return { jobId: args.jobId, chunkIndex: args.chunkIndex, appended: true };
    }
    await ctx.db.insert("codex_sync_job_chunks", {
      userScope,
      jobRef: job._id,
      chunkIndex: args.chunkIndex,
      payloadJson: args.payloadJson,
      messageCount: args.messageCount,
      byteSize: args.byteSize,
      createdAt: ts,
    });
    await ctx.db.patch(job._id, { updatedAt: ts });
    return { jobId: args.jobId, chunkIndex: args.chunkIndex, appended: true };
  },
});

export const sealConversationSyncJobSource = mutation({
  args: {
    actor: vActorContext,
    jobId: v.string(),
  },
  returns: v.object({
    jobId: v.string(),
    sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("processing")),
    totalChunks: v.number(),
    scheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const job = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_jobId", (q) => q.eq("userScope", userScope).eq("jobId", args.jobId))
      .first();
    if (!job) {
      throw new Error(`[E_SYNC_JOB_NOT_FOUND] Sync job not found: ${args.jobId}`);
    }
    if (job.sourceState !== "collecting") {
      return {
        jobId: args.jobId,
        sourceState: job.sourceState as SyncJobSourceState,
        totalChunks: Number(job.totalChunks ?? 0),
        scheduled: false,
      };
    }
    const chunkRows = await ctx.db
      .query("codex_sync_job_chunks")
      .withIndex("userScope_jobRef_chunkIndex", (q) =>
        q.eq("userScope", userScope).eq("jobRef", job._id),
      )
      .collect();
    const totalChunks = chunkRows.length;
    const ts = now();
    await ctx.db.patch(job._id, {
      sourceState: "sealed",
      totalChunks,
      updatedAt: ts,
      nextRunAt: ts,
    });
    await ctx.scheduler.runAfter(0, internal.threads.runConversationSyncJobChunk, {
      actor: args.actor,
      jobId: args.jobId,
    });
    const sourceState: SyncJobSourceState = "sealed";
    return {
      jobId: args.jobId,
      sourceState,
      totalChunks,
      scheduled: true,
    };
  },
});

export const cancelConversationSyncJob = mutation({
  args: {
    actor: vActorContext,
    jobId: v.string(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.string(),
    state: vSyncJobState,
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const job = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_jobId", (q) => q.eq("userScope", userScope).eq("jobId", args.jobId))
      .first();
    if (!job) {
      throw new Error(`[E_SYNC_JOB_NOT_FOUND] Sync job not found: ${args.jobId}`);
    }
    if (!(job.state === "syncing" || job.sourceState === "collecting")) {
      return { jobId: args.jobId, state: job.state as SyncJobState, cancelled: false };
    }
    const ts = now();
    await ctx.db.patch(job._id, {
      state: "cancelled",
      completedAt: ts,
      updatedAt: ts,
      ...(args.errorCode !== undefined ? { lastErrorCode: args.errorCode } : {}),
      ...(args.errorMessage !== undefined ? { lastErrorMessage: args.errorMessage } : {}),
    });
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q.eq("userScope", userScope).eq("userId", args.actor.userId).eq("conversationId", String(job.conversationId)),
      )
      .first();
    if (binding) {
      await ctx.db.patch(binding._id, {
        syncState: "drifted",
        syncJobState: "cancelled",
        syncJobUpdatedAt: ts,
        syncJobLastCursor: Number(job.lastCursor ?? 0),
        ...(args.errorCode !== undefined ? { syncJobErrorCode: args.errorCode, lastErrorCode: args.errorCode, lastErrorAt: ts } : {}),
        updatedAt: ts,
      });
    }
    const state: SyncJobState = "cancelled";
    return { jobId: args.jobId, state, cancelled: true };
  },
});

export const getConversationSyncJob = query({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    jobId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.string(),
      conversationId: v.string(),
      threadId: v.string(),
      runtimeConversationId: v.optional(v.string()),
      state: vSyncJobState,
      sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("processing")),
      policyVersion: v.number(),
      startedAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
      lastCursor: v.number(),
      processedChunkIndex: v.number(),
      totalChunks: v.number(),
      processedMessageCount: v.number(),
      expectedMessageCount: v.optional(v.number()),
      retryCount: v.number(),
      lastErrorCode: v.optional(v.string()),
      lastErrorMessage: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const jobs = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_userId_conversationId_startedAt", (q) =>
        q.eq("userScope", userScope).eq("userId", args.actor.userId).eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(16);
    const job = args.jobId === undefined
      ? jobs[0]
      : jobs.find((candidate) => String(candidate.jobId) === args.jobId);
    if (!job) {
      return null;
    }
    return {
      jobId: String(job.jobId),
      conversationId: String(job.conversationId),
      threadId: String(job.threadId),
      ...(job.runtimeConversationId !== undefined ? { runtimeConversationId: String(job.runtimeConversationId) } : {}),
      state: job.state as SyncJobState,
      sourceState: job.sourceState as SyncJobSourceState,
      policyVersion: Number(job.policyVersion),
      startedAt: Number(job.startedAt),
      updatedAt: Number(job.updatedAt),
      ...(job.completedAt !== undefined ? { completedAt: Number(job.completedAt) } : {}),
      lastCursor: Number(job.lastCursor),
      processedChunkIndex: Number(job.processedChunkIndex),
      totalChunks: Number(job.totalChunks),
      processedMessageCount: Number(job.processedMessageCount),
      ...(job.expectedMessageCount !== undefined ? { expectedMessageCount: Number(job.expectedMessageCount) } : {}),
      retryCount: Number(job.retryCount),
      ...(job.lastErrorCode !== undefined ? { lastErrorCode: String(job.lastErrorCode) } : {}),
      ...(job.lastErrorMessage !== undefined ? { lastErrorMessage: String(job.lastErrorMessage) } : {}),
    };
  },
});

export const listConversationSyncJobs = query({
  args: {
    actor: vActorContext,
    conversationId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      jobId: v.string(),
      state: vSyncJobState,
      sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("processing")),
      startedAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
      retryCount: v.number(),
      processedMessageCount: v.number(),
      expectedMessageCount: v.optional(v.number()),
      totalChunks: v.number(),
      processedChunkIndex: v.number(),
      lastErrorCode: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const rows = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_userId_conversationId_startedAt", (q) =>
        q.eq("userScope", userScope).eq("userId", args.actor.userId).eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(Math.max(1, Math.min(50, args.limit ?? 20)));
    return rows.map((job) => ({
      jobId: String(job.jobId),
      state: job.state as SyncJobState,
      sourceState: job.sourceState as SyncJobSourceState,
      startedAt: Number(job.startedAt),
      updatedAt: Number(job.updatedAt),
      ...(job.completedAt !== undefined ? { completedAt: Number(job.completedAt) } : {}),
      retryCount: Number(job.retryCount),
      processedMessageCount: Number(job.processedMessageCount),
      ...(job.expectedMessageCount !== undefined ? { expectedMessageCount: Number(job.expectedMessageCount) } : {}),
      totalChunks: Number(job.totalChunks),
      processedChunkIndex: Number(job.processedChunkIndex),
      ...(job.lastErrorCode !== undefined ? { lastErrorCode: String(job.lastErrorCode) } : {}),
    }));
  },
});

export const runConversationSyncJobChunk = internalMutation({
  args: {
    actor: vActorContext,
    jobId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userScope = userScopeFromActor(args.actor);
    const job = await ctx.db
      .query("codex_sync_jobs")
      .withIndex("userScope_jobId", (q) => q.eq("userScope", userScope).eq("jobId", args.jobId))
      .first();
    if (!job) {
      return null;
    }
    console.log(JSON.stringify({
      event: "sync_job_worker_start",
      jobId: args.jobId,
      state: job.state,
      sourceState: job.sourceState,
      processedChunkIndex: Number(job.processedChunkIndex ?? 0),
      totalChunks: Number(job.totalChunks ?? 0),
      retryCount: Number(job.retryCount ?? 0),
    }));
    if (job.state !== "syncing") {
      return null;
    }
    if (job.sourceState === "collecting") {
      return null;
    }
    const ts = now();
    const markBindingSyncFailed = async (errorCode: string) => {
      const binding = await ctx.db
        .query("codex_thread_bindings")
        .withIndex("userScope_userId_conversationId", (q) =>
          q.eq("userScope", userScope).eq("userId", job.userId).eq("conversationId", String(job.conversationId)),
        )
        .first();
      if (binding) {
        await ctx.db.patch(binding._id, {
          syncState: "drifted",
          syncJobState: "failed",
          syncJobUpdatedAt: ts,
          syncJobErrorCode: errorCode,
          lastErrorCode: errorCode,
          lastErrorAt: ts,
          updatedAt: ts,
        });
      }
    };
    const currentIndex = Number(job.processedChunkIndex ?? 0);
    const totalChunks = Number(job.totalChunks ?? 0);
    if (currentIndex >= totalChunks) {
      let expectedMessageIds = parseExpectedMessageIdsJson(job.expectedMessageIdsJson);
      if (expectedMessageIds.length === 0) {
        const chunkRows = await ctx.db
          .query("codex_sync_job_chunks")
          .withIndex("userScope_jobRef_chunkIndex", (q) =>
            q.eq("userScope", userScope).eq("jobRef", job._id),
          )
          .collect();
        const derivedEntries: SyncManifestEntry[] = [];
        const seenDerivedIds = new Set<string>();
        for (const chunkRow of chunkRows) {
          let parsedChunkEvents: InboundEvent[];
          try {
            parsedChunkEvents = parseChunkPayload(String(chunkRow.payloadJson));
          } catch (_error) {
            continue;
          }
          for (const entry of extractCanonicalMessageManifestFromEvents(parsedChunkEvents)) {
            const key = JSON.stringify([entry.turnId, entry.messageId]);
            if (seenDerivedIds.has(key)) {
              continue;
            }
            seenDerivedIds.add(key);
            derivedEntries.push(entry);
          }
        }
        expectedMessageIds = derivedEntries;
      }
      const expectedMessageCount = Number(job.expectedMessageCount ?? expectedMessageIds.length);
      let manifestMismatchCode: string | null = null;
      if (expectedMessageCount !== expectedMessageIds.length) {
        manifestMismatchCode = "E_SYNC_MANIFEST_EXPECTED_COUNT_MISMATCH";
      } else if (expectedMessageCount > 0) {
        const messageRows = await ctx.db
          .query("codex_messages")
          .withIndex("userScope_threadId_createdAt", (q) =>
            q.eq("userScope", userScope).eq("threadId", String(job.threadId)),
          )
          .collect();
        const persistedKeys = new Set(
          messageRows.map((row) => JSON.stringify([String(row.turnId), String(row.messageId)])),
        );
        let missingKey: string | null = null;
        for (const expectedEntry of expectedMessageIds) {
          const expectedKey = JSON.stringify([expectedEntry.turnId, expectedEntry.messageId]);
          if (!persistedKeys.has(expectedKey)) {
            manifestMismatchCode = "E_SYNC_MANIFEST_MISMATCH";
            missingKey = expectedKey;
            break;
          }
        }
        if (manifestMismatchCode) {
          console.log(JSON.stringify({
            event: "sync_job_manifest_missing",
            jobId: args.jobId,
            missingKey,
            expectedMessageCount,
            persistedCount: messageRows.length,
          }));
        }
      }
      if (manifestMismatchCode) {
        console.log(JSON.stringify({
          event: "sync_job_manifest_failed",
          jobId: args.jobId,
          code: manifestMismatchCode,
          expectedMessageCount,
          expectedIds: expectedMessageIds.length,
        }));
        await ctx.db.patch(job._id, {
          state: "failed",
          sourceState: "processing",
          completedAt: ts,
          updatedAt: ts,
          lastErrorCode: manifestMismatchCode,
          lastErrorMessage: `Sync manifest verification failed for job ${String(job.jobId)}.`,
        });
        const binding = await ctx.db
          .query("codex_thread_bindings")
          .withIndex("userScope_userId_conversationId", (q) =>
            q.eq("userScope", userScope).eq("userId", job.userId).eq("conversationId", String(job.conversationId)),
          )
          .first();
        if (binding) {
          await ctx.db.patch(binding._id, {
            syncState: "drifted",
            syncJobState: "failed",
            syncJobUpdatedAt: ts,
            syncJobLastCursor: Number(job.lastCursor ?? 0),
            syncJobErrorCode: manifestMismatchCode,
            lastErrorCode: manifestMismatchCode,
            lastErrorAt: ts,
            updatedAt: ts,
          });
        }
        return null;
      }
      await ctx.db.patch(job._id, {
        state: "synced",
        sourceState: "processing",
        completedAt: ts,
        updatedAt: ts,
      });
      console.log(JSON.stringify({
        event: "sync_job_synced",
        jobId: args.jobId,
        processedMessageCount: Number(job.processedMessageCount ?? 0),
        totalChunks,
      }));
      const binding = await ctx.db
        .query("codex_thread_bindings")
        .withIndex("userScope_userId_conversationId", (q) =>
          q.eq("userScope", userScope).eq("userId", job.userId).eq("conversationId", String(job.conversationId)),
        )
        .first();
      if (binding) {
        await ctx.db.patch(binding._id, {
          syncState: "synced",
          lastSyncedCursor: Number(job.lastCursor ?? 0),
          syncJobState: "synced",
          syncJobUpdatedAt: ts,
          syncJobLastCursor: Number(job.lastCursor ?? 0),
          syncJobErrorCode: undefined,
          updatedAt: ts,
        });
      }
      return null;
    }

    await ctx.db.patch(job._id, {
      sourceState: "processing",
      updatedAt: ts,
    });
    const chunk = await ctx.db
      .query("codex_sync_job_chunks")
      .withIndex("userScope_jobRef_chunkIndex", (q) =>
        q.eq("userScope", userScope).eq("jobRef", job._id).eq("chunkIndex", currentIndex),
      )
      .first();
    if (!chunk) {
      console.log(JSON.stringify({
        event: "sync_job_chunk_missing",
        jobId: args.jobId,
        chunkIndex: currentIndex,
      }));
      await ctx.db.patch(job._id, {
        state: "failed",
        completedAt: ts,
        updatedAt: ts,
        lastErrorCode: "E_SYNC_JOB_CHUNK_MISSING",
        lastErrorMessage: `Missing chunk ${currentIndex}.`,
      });
      await markBindingSyncFailed("E_SYNC_JOB_CHUNK_MISSING");
      return null;
    }

    let events: InboundEvent[];
    try {
      events = parseChunkPayload(String(chunk.payloadJson));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({
        event: "sync_job_chunk_parse_failed",
        jobId: args.jobId,
        chunkIndex: currentIndex,
        error: errorMessage,
      }));
      await ctx.db.patch(job._id, {
        state: "failed",
        completedAt: ts,
        updatedAt: ts,
        lastErrorCode: "E_SYNC_JOB_CHUNK_PARSE_FAILED",
        lastErrorMessage: errorMessage,
      });
      await markBindingSyncFailed("E_SYNC_JOB_CHUNK_PARSE_FAILED");
      return null;
    }

    console.log(JSON.stringify({
      event: "sync_job_chunk_processing",
      jobId: args.jobId,
      chunkIndex: currentIndex,
      eventCount: events.length,
      chunkMessageCount: Number(chunk.messageCount ?? 0),
    }));
    const processed = await processSyncEventsWithAdaptiveSplit(ctx, {
      actor: buildSyncActorFromJob(job),
      sessionId: `sync-job:${String(job.jobId)}`,
      threadId: String(job.threadId),
      events,
    });
    if (!processed.ok) {
      const nextRetryCount = Number(job.retryCount ?? 0) + 1;
      const isExhausted = nextRetryCount >= SYNC_JOB_MAX_RETRY_ATTEMPTS;
      const backoffMs = SYNC_JOB_RETRY_BACKOFF_MS[Math.min(nextRetryCount - 1, SYNC_JOB_RETRY_BACKOFF_MS.length - 1)] ?? 16000;
      const nextRunAt = ts + backoffMs;
      console.log(JSON.stringify({
        event: "sync_job_retry",
        jobId: args.jobId,
        chunkIndex: currentIndex,
        retryCount: nextRetryCount,
        exhausted: isExhausted,
        backoffMs,
        code: processed.errorCode,
      }));
      await ctx.db.patch(job._id, {
        retryCount: nextRetryCount,
        ...(isExhausted ? { completedAt: ts } : {}),
        updatedAt: ts,
        nextRunAt,
        lastErrorCode: processed.errorCode,
        lastErrorMessage: processed.errorMessage,
        ...(isExhausted ? { state: "failed" as SyncJobState } : {}),
      });
      if (!isExhausted) {
        await ctx.scheduler.runAfter(backoffMs, internal.threads.runConversationSyncJobChunk, args);
      } else {
        await markBindingSyncFailed(processed.errorCode);
      }
      return null;
    }

    const nextProcessedChunkIndex = currentIndex + 1;
    const nextEventCursor = Math.max(Number(job.lastCursor ?? 0), processed.maxEventCursor);
    const nextProcessedMessageCount = Number(job.processedMessageCount ?? 0) + Number(chunk.messageCount ?? 0);
    await ctx.db.patch(job._id, {
      processedChunkIndex: nextProcessedChunkIndex,
      processedMessageCount: nextProcessedMessageCount,
      lastCursor: nextEventCursor,
      retryCount: 0,
      nextRunAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      sourceState: "sealed",
      updatedAt: ts,
    });

    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_conversationId", (q) =>
        q.eq("userScope", userScope).eq("userId", job.userId).eq("conversationId", String(job.conversationId)),
      )
      .first();
    if (binding) {
      await ctx.db.patch(binding._id, {
        syncState: "syncing",
        lastSyncedCursor: nextEventCursor,
        syncJobState: "syncing",
        syncJobUpdatedAt: ts,
        syncJobLastCursor: nextEventCursor,
        updatedAt: ts,
      });
    }
    console.log(JSON.stringify({
      event: "sync_job_chunk_completed",
      jobId: args.jobId,
      chunkIndex: currentIndex,
      nextChunkIndex: nextProcessedChunkIndex,
      processedMessageCount: nextProcessedMessageCount,
      totalChunks,
    }));
    await ctx.scheduler.runAfter(0, internal.threads.runConversationSyncJobChunk, args);
    return null;
  },
});

export const deleteCascade = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deletionJobId: v.string() }),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);

    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "thread",
      threadId: args.threadId,
      threadRef,
      status: "queued",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );

    return { deletionJobId };
  },
});

export const scheduleDeleteCascade = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    const delayMs = clampDeleteDelayMs(args.delayMs);
    const scheduledFor = ts + delayMs;
    const scheduledFnId = await ctx.scheduler.runAfter(
      delayMs,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );

    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "thread",
      threadId: args.threadId,
      threadRef,
      status: "scheduled",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      scheduledFor,
      scheduledFnId,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    return { deletionJobId, scheduledFor };
  },
});

export const purgeActorData = mutation({
  args: {
    actor: vActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deletionJobId: v.string() }),
  handler: async (ctx, args) => {
    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "actor",
      status: "queued",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );

    return { deletionJobId };
  },
});

export const schedulePurgeActorData = mutation({
  args: {
    actor: vActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    const delayMs = clampDeleteDelayMs(args.delayMs);
    const scheduledFor = ts + delayMs;
    const scheduledFnId = await ctx.scheduler.runAfter(
      delayMs,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );
    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "actor",
      status: "scheduled",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      scheduledFor,
      scheduledFnId,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    return { deletionJobId, scheduledFor };
  },
});

export const cancelScheduledDeletion = mutation({
  args: {
    actor: vActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await getDeletionJobForActor({
      ctx,
      actor: args.actor,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return { deletionJobId: args.deletionJobId, cancelled: false };
    }
    if (job.status !== "scheduled") {
      return { deletionJobId: args.deletionJobId, cancelled: false };
    }
    if (job.scheduledFnId !== undefined) {
      await ctx.scheduler.cancel(job.scheduledFnId);
    }
    const ts = now();
    await ctx.db.patch(job._id, {
      status: "cancelled",
      scheduledFnId: undefined,
      scheduledFor: undefined,
      cancelledAt: ts,
      updatedAt: ts,
      completedAt: ts,
    });
    return { deletionJobId: args.deletionJobId, cancelled: true };
  },
});

export const forceRunScheduledDeletion = mutation({
  args: {
    actor: vActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    forced: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await getDeletionJobForActor({
      ctx,
      actor: args.actor,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return { deletionJobId: args.deletionJobId, forced: false };
    }
    if (job.status !== "scheduled") {
      return { deletionJobId: args.deletionJobId, forced: false };
    }
    if (job.scheduledFnId !== undefined) {
      await ctx.scheduler.cancel(job.scheduledFnId);
    }
    const ts = now();
    await ctx.db.patch(job._id, {
      status: "queued",
      scheduledFnId: undefined,
      scheduledFor: undefined,
      updatedAt: ts,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.sessions.runDeletionJobChunk,
      {
        userScope: String(job.userScope),
        deletionJobId: String(job.deletionJobId),
        ...(job.batchSize !== undefined ? { batchSize: Number(job.batchSize) } : {}),
      },
    );
    return { deletionJobId: args.deletionJobId, forced: true };
  },
});

export const getDeletionJobStatus = query({
  args: {
    actor: vActorContext,
    deletionJobId: v.string(),
  },
  returns: v.union(v.null(), vDeletionJobStatus),
  handler: async (ctx, args) => {
    const job = await getDeletionJobForActor({
      ctx,
      actor: args.actor,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return null;
    }

    return {
      deletionJobId: String(job.deletionJobId),
      status: job.status,
      targetKind: job.targetKind,
      ...(job.threadId !== undefined ? { threadId: String(job.threadId) } : {}),
      ...(job.turnId !== undefined ? { turnId: String(job.turnId) } : {}),
      ...(job.batchSize !== undefined ? { batchSize: Number(job.batchSize) } : {}),
      ...(job.scheduledFor !== undefined ? { scheduledFor: Number(job.scheduledFor) } : {}),
      ...(job.reason !== undefined ? { reason: String(job.reason) } : {}),
      ...(job.phase !== undefined ? { phase: String(job.phase) } : {}),
      deletedCountsByTable: parseDeletedCountsToArray(String(job.deletedCountsJson)),
      ...(job.errorCode !== undefined ? { errorCode: String(job.errorCode) } : {}),
      ...(job.errorMessage !== undefined ? { errorMessage: String(job.errorMessage) } : {}),
      createdAt: Number(job.createdAt),
      ...(job.startedAt !== undefined ? { startedAt: Number(job.startedAt) } : {}),
      ...(job.completedAt !== undefined ? { completedAt: Number(job.completedAt) } : {}),
      ...(job.cancelledAt !== undefined ? { cancelledAt: Number(job.cancelledAt) } : {}),
      updatedAt: Number(job.updatedAt),
    };
  },
});

export const list = query({
  args: {
    actor: vActorContext,
    paginationOpts: paginationOptsValidator,
    includeArchived: v.optional(v.boolean()),
  },
  returns: vThreadListResult,
  handler: async (ctx, args) => {
    const cursor = decodeKeysetCursor<{ updatedAt: number; threadId: string }>(
      args.paginationOpts.cursor,
    );

    const scanned = await ctx.db
      .query("codex_threads")
      .withIndex("userScope_userId_updatedAt_threadId", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("userId", args.actor.userId),
      )
      .filter((q) =>
        q.and(
          args.includeArchived === true
            ? q.eq(q.field("userScope"), userScopeFromActor(args.actor))
            : q.neq(q.field("status"), "archived"),
          cursor
            ? q.or(
                q.lt(q.field("updatedAt"), cursor.updatedAt),
                q.and(
                  q.eq(q.field("updatedAt"), cursor.updatedAt),
                  q.lt(q.field("threadId"), cursor.threadId),
                ),
              )
            : q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
        ),
      )
      .order("desc")
      .take(args.paginationOpts.numItems + 1);

    const result = keysetPageResult(scanned, args.paginationOpts, (thread) => ({
      updatedAt: Number(thread.updatedAt),
      threadId: String(thread.threadId),
    }));

    return {
      ...result,
      page: (await Promise.all(
        result.page.map(async (thread) => {
          const threadId = String(thread.threadId);
          const [binding, lifecycleEvents, earliestMessages] = await Promise.all([
            ctx.db
              .query("codex_thread_bindings")
              .withIndex("userScope_userId_threadId", (q) =>
                q
                  .eq("userScope", userScopeFromActor(args.actor))
                  .eq("userId", args.actor.userId)
                  .eq("threadId", threadId),
              )
              .first(),
            ctx.db
              .query("codex_lifecycle_events")
              .withIndex("userScope_threadId_createdAt", (q) =>
                q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", threadId),
              )
              .order("desc")
              .take(20),
            ctx.db
              .query("codex_messages")
              .withIndex("userScope_threadId_createdAt", (q) =>
                q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", threadId),
              )
              .order("asc")
              .take(30),
          ]);
          const firstUserMessage = earliestMessages.find((message) => message.role === "user");
          const preview = deriveThreadPreview({
            lifecycleEvents: lifecycleEvents.map((event) => ({
              kind: String(event.kind),
              payloadJson: String(event.payloadJson),
            })),
            firstUserMessageText: firstUserMessage ? String(firstUserMessage.text) : null,
          });
          if (!binding) {
            return null;
          }
          return {
            conversationId: String(binding.conversationId),
            status: thread.status,
            updatedAt: Number(thread.updatedAt),
            preview,
          };
        }),
      )).filter((row): row is { conversationId: string; status: "active" | "archived" | "failed"; updatedAt: number; preview: string } => row !== null),
    };
  },
});

export const getState = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: vThreadState,
  handler: async (ctx, args) => {
    const thread = await requireThreadForActor(ctx, args.actor, args.threadId);
    const {
      turns,
      streams,
      stats,
      approvals,
      recentMessages,
      lifecycle,
    } = await loadThreadSnapshotRows({
      ctx,
      actor: args.actor,
      threadId: args.threadId,
    });

    const allStreams = streams.map((stream) => ({
      streamId: String(stream.streamId),
      turnId: String(stream.turnId),
      state: String(stream.state.kind),
      startedAt: Number(stream.startedAt),
    }));
    const activeStreamIds = new Set(
      allStreams.filter((stream) => stream.state === "streaming").map((stream) => stream.streamId),
    );
    const finalizedStaleStreamIds = identifyStaleStreamingStatIds({
      activeStreamIds,
      stats: stats.map((stat) => ({
        streamId: String(stat.streamId),
        state: stat.state,
      })),
    });

    const lifecycleMarkers = lifecycle
      .filter((event) => event.kind === STREAM_DRAIN_COMPLETE_KIND)
      .map((event) => {
        let streamId: string | undefined;
        try {
          const parsed = JSON.parse(event.payloadJson) as { streamId?: unknown };
          if (typeof parsed.streamId === "string") {
            streamId = parsed.streamId;
          }
        } catch (error) {
          console.warn("[threads] Failed to parse lifecycle event payloadJson:", error);
          streamId = undefined;
        }
        return {
          kind: String(event.kind),
          ...(event.turnId !== undefined ? { turnId: String(event.turnId) } : {}),
          ...(streamId !== undefined ? { streamId } : {}),
          createdAt: Number(event.createdAt),
        };
      });

    return {
      threadId: String(thread.threadId),
      threadStatus: String(thread.status),
      turns: turns.map((turn) => ({
        turnId: String(turn.turnId),
        status: String(turn.status),
        startedAt: Number(turn.startedAt),
        ...(turn.completedAt !== undefined ? { completedAt: Number(turn.completedAt) } : {}),
      })),
      activeStreams: allStreams.filter((stream) => stream.state === "streaming"),
      allStreams,
      streamStats: stats.map((stat) => ({
        streamId: String(stat.streamId),
        state: finalizedStaleStreamIds.has(String(stat.streamId)) ? "finished" : stat.state,
        deltaCount: Number(stat.deltaCount),
        latestCursor: Number(stat.latestCursor),
      })),
      pendingApprovals: approvals.map((approval) => ({
        turnId: String(approval.turnId),
        itemId: String(approval.itemId),
        kind: String(approval.kind),
        ...(approval.reason ? { reason: String(approval.reason) } : {}),
      })),
      recentMessages: recentMessages.map((message) => ({
        messageId: String(message.messageId),
        turnId: String(message.turnId),
        role: message.role,
        status: message.status,
        text: String(message.text),
        createdAt: Number(message.createdAt),
        updatedAt: Number(message.updatedAt),
        ...(message.completedAt !== undefined ? { completedAt: Number(message.completedAt) } : {}),
      })),
      lifecycleMarkers,
    };
  },
});
