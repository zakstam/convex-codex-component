import { now } from "../utils.js";
import type { IngestContext, NormalizedInboundEvent } from "./types.js";
import type { IngestStateCache } from "./stateCache.js";

export async function applyMessageEffectsForEvent(
  ingest: IngestContext,
  event: NormalizedInboundEvent,
  cache: IngestStateCache,
): Promise<void> {
  const turnId = event.turnId;
  if (!turnId) {
    return;
  }

  if (event.durableMessage) {
    const existing = await cache.getMessageRecord(turnId, event.durableMessage.messageId);

    if (!existing) {
      const nextOrder = await cache.nextOrderForTurn(turnId);

      const newId = await ingest.ctx.db.insert("codex_messages", {
        tenantId: ingest.args.actor.tenantId,
        userId: ingest.args.actor.userId,
        threadId: ingest.args.threadId,
        turnId,
        messageId: event.durableMessage.messageId,
        role: event.durableMessage.role,
        status: event.durableMessage.status,
        text: event.durableMessage.text,
        sourceItemType: event.durableMessage.sourceItemType,
        orderInTurn: nextOrder,
        payloadJson: event.durableMessage.payloadJson,
        ...(event.durableMessage.status === "failed" ? { error: "item failed" } : {}),
        createdAt: event.createdAt,
        updatedAt: now(),
        ...(event.durableMessage.status !== "streaming" ? { completedAt: now() } : {}),
      });
      cache.setMessageRecord(turnId, event.durableMessage.messageId, {
        _id: newId,
        status: event.durableMessage.status,
        text: event.durableMessage.text,
      });
    } else {
      const nextStatus = (() => {
        if (existing.status === "failed") {
          return "failed" as const;
        }
        if (existing.status === "interrupted" && event.durableMessage?.status !== "failed") {
          return "interrupted" as const;
        }
        if (event.durableMessage?.status === "streaming") {
          return existing.status;
        }
        return event.durableMessage?.status ?? existing.status;
      })();

      cache.queueMessagePatch(existing._id, {
        role: event.durableMessage.role,
        status: nextStatus,
        text: event.durableMessage.text,
        sourceItemType: event.durableMessage.sourceItemType,
        payloadJson: event.durableMessage.payloadJson,
        ...(nextStatus === "failed" ? { error: "item failed" } : {}),
        updatedAt: now(),
        ...(nextStatus !== "streaming" ? { completedAt: now() } : {}),
      });
      cache.setMessageRecord(turnId, event.durableMessage.messageId, {
        ...existing,
        status: nextStatus,
        text: event.durableMessage.text,
      });
    }
  }

  if (!event.durableDelta) {
    return;
  }

  const existing = await cache.getMessageRecord(turnId, event.durableDelta.messageId);

  if (!existing) {
    const nextOrder = await cache.nextOrderForTurn(turnId);
    const messageId = await ingest.ctx.db.insert("codex_messages", {
      tenantId: ingest.args.actor.tenantId,
      userId: ingest.args.actor.userId,
      threadId: ingest.args.threadId,
      turnId,
      messageId: event.durableDelta.messageId,
      role: "assistant",
      status: "streaming",
      text: event.durableDelta.delta,
      sourceItemType: "agentMessage",
      orderInTurn: nextOrder,
      payloadJson: JSON.stringify({
        type: "agentMessage",
        id: event.durableDelta.messageId,
        text: event.durableDelta.delta,
      }),
      createdAt: event.createdAt,
      updatedAt: now(),
    });
    cache.setMessageRecord(turnId, event.durableDelta.messageId, {
      _id: messageId,
      status: "streaming",
      text: event.durableDelta.delta,
    });
    return;
  }

  if (existing.status !== "streaming") {
    return;
  }

  const nextText = `${existing.text}${event.durableDelta.delta}`;
  cache.queueMessagePatch(existing._id, {
    text: nextText,
    payloadJson: JSON.stringify({
      type: "agentMessage",
      id: event.durableDelta.messageId,
      text: nextText,
    }),
    updatedAt: now(),
  });
  cache.setMessageRecord(turnId, event.durableDelta.messageId, {
    ...existing,
    text: nextText,
  });
}
