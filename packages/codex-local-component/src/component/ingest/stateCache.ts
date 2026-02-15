import type { MutationCtx } from "../_generated/server.js";
import type { GenericId } from "convex/values";
import type { CachedApproval, CachedMessage, CachedStream } from "./types.js";

export type IngestStateCache = {
  nextOrderForTurn: (turnId: string) => Promise<number>;
  getMessageRecord: (turnId: string, messageId: string) => Promise<CachedMessage | null>;
  setMessageRecord: (turnId: string, messageId: string, value: CachedMessage | null) => void;
  getApprovalRecord: (turnId: string, itemId: string) => Promise<CachedApproval | null>;
  setApprovalRecord: (turnId: string, itemId: string, value: CachedApproval | null) => void;
  getStreamRecord: (streamId: string) => Promise<CachedStream | null>;
  setStreamRecord: (streamId: string, value: CachedStream | null) => void;
  queueMessagePatch: (id: GenericId<"codex_messages">, patch: Record<string, unknown>) => void;
  flushMessagePatches: () => Promise<void>;
};

export function createIngestStateCache(args: {
  ctx: MutationCtx;
  userScope: string;
  threadId: string;
}): IngestStateCache {
  const { ctx, userScope, threadId } = args;

  const messageOrderCacheByTurn = new Map<string, number>();
  const messageByTurnAndId = new Map<string, Map<string, CachedMessage | null>>();
  const streamById = new Map<string, CachedStream | null>();
  const approvalByTurnAndId = new Map<string, Map<string, CachedApproval | null>>();
  const messagePatchById = new Map<GenericId<"codex_messages">, Record<string, unknown>>();

  const getNestedValue = <T>(store: Map<string, Map<string, T>>, outerKey: string, innerKey: string): T | undefined =>
    store.get(outerKey)?.get(innerKey);

  const setNestedValue = <T>(store: Map<string, Map<string, T>>, outerKey: string, innerKey: string, value: T): void => {
    const inner = store.get(outerKey);
    if (inner) {
      inner.set(innerKey, value);
      return;
    }
    store.set(outerKey, new Map([[innerKey, value]]));
  };

  const nextOrderForTurn = async (turnId: string): Promise<number> => {
    const cached = messageOrderCacheByTurn.get(turnId);
    if (cached !== undefined) {
      messageOrderCacheByTurn.set(turnId, cached + 1);
      return cached;
    }

    const lastMessage = await ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_turnId_orderInTurn", (q) =>
        q.eq("userScope", userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .order("desc")
      .take(1);
    const next = (lastMessage[0]?.orderInTurn ?? -1) + 1;
    messageOrderCacheByTurn.set(turnId, next + 1);
    return next;
  };

  const getMessageRecord = async (turnId: string, messageId: string): Promise<CachedMessage | null> => {
    const cached = getNestedValue(messageByTurnAndId, turnId, messageId);
    if (cached !== undefined) {
      return cached;
    }
    const existing = await ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_turnId_messageId", (q) =>
        q
          .eq("userScope", userScope)
          .eq("threadId", threadId)
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
    setNestedValue(messageByTurnAndId, turnId, messageId, normalized);
    return normalized;
  };

  const setMessageRecord = (turnId: string, messageId: string, value: CachedMessage | null): void => {
    setNestedValue(messageByTurnAndId, turnId, messageId, value);
  };

  const getApprovalRecord = async (turnId: string, itemId: string): Promise<CachedApproval | null> => {
    const cached = getNestedValue(approvalByTurnAndId, turnId, itemId);
    if (cached !== undefined) {
      return cached;
    }
    const existing = await ctx.db
      .query("codex_approvals")
      .withIndex("userScope_threadId_turnId_itemId", (q) =>
        q.eq("userScope", userScope).eq("threadId", threadId).eq("turnId", turnId).eq("itemId", itemId),
      )
      .first();
    const normalized = existing
      ? {
          _id: existing._id,
          status: existing.status,
        }
      : null;
    setNestedValue(approvalByTurnAndId, turnId, itemId, normalized);
    return normalized;
  };

  const setApprovalRecord = (turnId: string, itemId: string, value: CachedApproval | null): void => {
    setNestedValue(approvalByTurnAndId, turnId, itemId, value);
  };

  const getStreamRecord = async (streamId: string): Promise<CachedStream | null> => {
    if (streamById.has(streamId)) {
      return streamById.get(streamId) ?? null;
    }
    const stream = await ctx.db
      .query("codex_streams")
      .withIndex("userScope_streamId", (q) => q.eq("userScope", userScope).eq("streamId", streamId))
      .first();
    const normalized = stream
      ? {
          _id: stream._id,
          turnId: stream.turnId,
          turnRef: stream.turnRef,
          state: { kind: stream.state.kind },
        }
      : null;
    streamById.set(streamId, normalized);
    return normalized;
  };

  const setStreamRecord = (streamId: string, value: CachedStream | null): void => {
    streamById.set(streamId, value);
  };

  const queueMessagePatch = (id: GenericId<"codex_messages">, patch: Record<string, unknown>): void => {
    const existing = messagePatchById.get(id);
    if (!existing) {
      messagePatchById.set(id, { ...patch });
      return;
    }
    messagePatchById.set(id, { ...existing, ...patch });
  };

  const flushMessagePatches = async (): Promise<void> => {
    if (messagePatchById.size === 0) {
      return;
    }
    const pending = Array.from(messagePatchById.entries());
    messagePatchById.clear();
    await Promise.all(
      pending.map(([id, patch]) => ctx.db.patch(id, patch)),
    );
  };

  return {
    nextOrderForTurn,
    getMessageRecord,
    setMessageRecord,
    getApprovalRecord,
    setApprovalRecord,
    getStreamRecord,
    setStreamRecord,
    queueMessagePatch,
    flushMessagePatches,
  };
}
