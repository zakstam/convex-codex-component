import type { MutationCtx } from "../_generated/server.js";
import type { CachedApproval, CachedMessage, CachedStream } from "./types.js";

export type IngestStateCache = {
  nextOrderForTurn: (turnId: string) => Promise<number>;
  getMessageRecord: (turnId: string, messageId: string) => Promise<CachedMessage | null>;
  setMessageRecord: (turnId: string, messageId: string, value: CachedMessage | null) => void;
  getApprovalRecord: (turnId: string, itemId: string) => Promise<CachedApproval | null>;
  setApprovalRecord: (turnId: string, itemId: string, value: CachedApproval | null) => void;
  getStreamRecord: (streamId: string) => Promise<CachedStream | null>;
  setStreamRecord: (streamId: string, value: CachedStream | null) => void;
};

export function createIngestStateCache(args: {
  ctx: MutationCtx;
  tenantId: string;
  threadId: string;
}): IngestStateCache {
  const { ctx, tenantId, threadId } = args;

  const messageOrderCacheByTurn = new Map<string, number>();
  const messageByKey = new Map<string, CachedMessage | null>();
  const streamById = new Map<string, CachedStream | null>();
  const approvalByKey = new Map<string, CachedApproval | null>();

  const messageKey = (turnId: string, messageId: string): string =>
    `${tenantId}:${threadId}:${turnId}:${messageId}`;

  const approvalKey = (turnId: string, itemId: string): string =>
    `${tenantId}:${threadId}:${turnId}:${itemId}`;

  const nextOrderForTurn = async (turnId: string): Promise<number> => {
    const cached = messageOrderCacheByTurn.get(turnId);
    if (cached !== undefined) {
      messageOrderCacheByTurn.set(turnId, cached + 1);
      return cached;
    }

    const lastMessage = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_turnId_orderInTurn", (q) =>
        q.eq("tenantId", tenantId).eq("threadId", threadId).eq("turnId", turnId),
      )
      .order("desc")
      .take(1);
    const next = (lastMessage[0]?.orderInTurn ?? -1) + 1;
    messageOrderCacheByTurn.set(turnId, next + 1);
    return next;
  };

  const getMessageRecord = async (turnId: string, messageId: string): Promise<CachedMessage | null> => {
    const key = messageKey(turnId, messageId);
    if (messageByKey.has(key)) {
      return messageByKey.get(key) ?? null;
    }
    const existing = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_turnId_messageId", (q) =>
        q
          .eq("tenantId", tenantId)
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
    messageByKey.set(key, normalized);
    return normalized;
  };

  const setMessageRecord = (turnId: string, messageId: string, value: CachedMessage | null): void => {
    messageByKey.set(messageKey(turnId, messageId), value);
  };

  const getApprovalRecord = async (turnId: string, itemId: string): Promise<CachedApproval | null> => {
    const key = approvalKey(turnId, itemId);
    if (approvalByKey.has(key)) {
      return approvalByKey.get(key) ?? null;
    }
    const existing = await ctx.db
      .query("codex_approvals")
      .withIndex("tenantId_threadId_turnId_itemId", (q) =>
        q.eq("tenantId", tenantId).eq("threadId", threadId).eq("turnId", turnId).eq("itemId", itemId),
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

  const setApprovalRecord = (turnId: string, itemId: string, value: CachedApproval | null): void => {
    approvalByKey.set(approvalKey(turnId, itemId), value);
  };

  const getStreamRecord = async (streamId: string): Promise<CachedStream | null> => {
    if (streamById.has(streamId)) {
      return streamById.get(streamId) ?? null;
    }
    const stream = await ctx.db
      .query("codex_streams")
      .withIndex("tenantId_streamId", (q) => q.eq("tenantId", tenantId).eq("streamId", streamId))
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

  const setStreamRecord = (streamId: string, value: CachedStream | null): void => {
    streamById.set(streamId, value);
  };

  return {
    nextOrderForTurn,
    getMessageRecord,
    setMessageRecord,
    getApprovalRecord,
    setApprovalRecord,
    getStreamRecord,
    setStreamRecord,
  };
}
