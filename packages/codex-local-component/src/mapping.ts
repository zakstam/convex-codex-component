import type { CodexUIMessage } from "./client/types.js";

export type CodexDurableMessageLike = {
  turnId: string;
  messageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  status: "streaming" | "completed" | "failed" | "interrupted";
  text: string;
  orderInTurn: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
};

export type CodexStreamDeltaLike = {
  streamId: string;
  cursorStart: number;
  cursorEnd: number;
  kind: string;
  payloadJson: string;
};

type OverlayMessage = {
  turnId: string;
  messageId: string;
  text: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
  error?: string;
  lastCursor: number;
};

const STATUS_PRIORITY: Record<CodexUIMessage["status"], number> = {
  streaming: 0,
  completed: 1,
  interrupted: 2,
  failed: 3,
};

function parseMethodPayload(
  payloadJson: string,
  method: string,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.method !== method) {
    return null;
  }
  const params = record.params;
  if (!params || typeof params !== "object") {
    return null;
  }
  return params as Record<string, unknown>;
}

function overlayKey(turnId: string, messageId: string): string {
  return `${turnId}:${messageId}`;
}

function durableKey(message: CodexDurableMessageLike): string {
  if (message.messageId) {
    return overlayKey(message.turnId, message.messageId);
  }
  return `${message.turnId}:order:${message.orderInTurn}`;
}

export type CodexOverlayMessage = OverlayMessage;

export function extractCodexOverlayMessages(
  deltas: CodexStreamDeltaLike[],
): Map<string, OverlayMessage> {
  const sorted = [...deltas].sort((a, b) => a.cursorEnd - b.cursorEnd);
  const byKey = new Map<string, OverlayMessage>();

  for (const delta of sorted) {
    if (delta.kind === "item/agentMessage/delta") {
      const params = parseMethodPayload(delta.payloadJson, "item/agentMessage/delta");
      const turnId = typeof params?.turnId === "string" ? params.turnId : null;
      const messageId = typeof params?.itemId === "string" ? params.itemId : null;
      const textDelta = typeof params?.delta === "string" ? params.delta : null;
      if (!turnId || !messageId || textDelta === null) {
        continue;
      }
      const key = overlayKey(turnId, messageId);
      const existing = byKey.get(key);
      byKey.set(key, {
        turnId,
        messageId,
        text: `${existing?.text ?? ""}${textDelta}`,
        status: existing?.status ?? "streaming",
        ...(existing?.error ? { error: existing.error } : {}),
        lastCursor: delta.cursorEnd,
      });
      continue;
    }

    if (delta.kind === "item/started" || delta.kind === "item/completed") {
      const params = parseMethodPayload(delta.payloadJson, delta.kind);
      const turnId = typeof params?.turnId === "string" ? params.turnId : null;
      const item =
        params && typeof params.item === "object" && params.item
          ? (params.item as Record<string, unknown>)
          : null;
      if (!turnId || !item || item.type !== "agentMessage" || typeof item.id !== "string") {
        continue;
      }
      const key = overlayKey(turnId, item.id);
      const existing = byKey.get(key);
      const nextText = typeof item.text === "string" ? item.text : (existing?.text ?? "");
      byKey.set(key, {
        turnId,
        messageId: item.id,
        text: nextText,
        status: delta.kind === "item/completed" ? "completed" : (existing?.status ?? "streaming"),
        ...(existing?.error ? { error: existing.error } : {}),
        lastCursor: delta.cursorEnd,
      });
      continue;
    }

    if (delta.kind === "error") {
      const params = parseMethodPayload(delta.payloadJson, "error");
      const turnId = typeof params?.turnId === "string" ? params.turnId : null;
      const errorMessage = (() => {
        if (!params) {
          return "stream error";
        }
        const error =
          typeof params.error === "object" && params.error
            ? (params.error as Record<string, unknown>)
            : null;
        return typeof error?.message === "string" ? error.message : "stream error";
      })();
      if (!turnId) {
        continue;
      }
      for (const [key, value] of byKey) {
        if (value.turnId !== turnId) {
          continue;
        }
        byKey.set(key, {
          ...value,
          status: "failed",
          error: errorMessage,
          lastCursor: delta.cursorEnd,
        });
      }
    }
  }

  return byKey;
}

function choosePreferredText(durableText: string, overlayText: string): string {
  if (!overlayText) {
    return durableText;
  }
  if (!durableText) {
    return overlayText;
  }
  if (overlayText.startsWith(durableText)) {
    return overlayText;
  }
  if (durableText.startsWith(overlayText)) {
    return durableText;
  }
  if (overlayText.length < durableText.length) {
    return durableText;
  }
  if (overlayText.startsWith(" ")) {
    return `${durableText}${overlayText}`;
  }
  return overlayText.length >= durableText.length ? overlayText : durableText;
}

function choosePreferredStatus(
  durableStatus: CodexUIMessage["status"],
  overlayStatus: CodexUIMessage["status"],
): CodexUIMessage["status"] {
  if (STATUS_PRIORITY[overlayStatus] > STATUS_PRIORITY[durableStatus]) {
    return overlayStatus;
  }
  return durableStatus;
}

function sortChronological(a: CodexUIMessage, b: CodexUIMessage): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  if (a.turnId !== b.turnId) {
    return a.turnId < b.turnId ? -1 : 1;
  }
  if (a.orderInTurn !== b.orderInTurn) {
    return a.orderInTurn - b.orderInTurn;
  }
  if (a.messageId === b.messageId) {
    return 0;
  }
  return a.messageId < b.messageId ? -1 : 1;
}

export function toCodexUIMessage(message: CodexDurableMessageLike): CodexUIMessage {
  return {
    messageId: message.messageId ?? `${message.turnId}:${message.orderInTurn}`,
    turnId: message.turnId,
    role: message.role,
    status: message.status,
    text: message.text,
    orderInTurn: message.orderInTurn,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    ...(typeof message.completedAt === "number" ? { completedAt: message.completedAt } : {}),
    ...(message.error ? { error: message.error } : {}),
  };
}

export function mergeCodexDurableAndStreamMessages(
  durableMessages: CodexDurableMessageLike[],
  streamDeltas: CodexStreamDeltaLike[],
): CodexUIMessage[] {
  const overlayByKey = extractCodexOverlayMessages(streamDeltas);
  const mergedByKey = new Map<string, CodexUIMessage>();

  for (const durable of durableMessages) {
    const key = durableKey(durable);
    const overlay =
      durable.messageId ? overlayByKey.get(overlayKey(durable.turnId, durable.messageId)) : undefined;

    const next = toCodexUIMessage(durable);
    if (overlay && durable.status === "streaming") {
      const status = choosePreferredStatus(next.status, overlay.status);
      next.status = status;
      next.text = choosePreferredText(next.text, overlay.text);
      if (status === "failed" || status === "interrupted") {
        if (overlay.error) {
          next.error = overlay.error;
        }
      }
      if (status !== "streaming" && !next.completedAt) {
        next.completedAt = next.updatedAt;
      }
    }

    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, next);
      continue;
    }

    const chosenStatus = choosePreferredStatus(existing.status, next.status);
    if (chosenStatus === next.status && chosenStatus !== existing.status) {
      mergedByKey.set(key, next);
      continue;
    }
    if (next.updatedAt > existing.updatedAt) {
      mergedByKey.set(key, next);
      continue;
    }
    if (next.text.length > existing.text.length) {
      mergedByKey.set(key, next);
    }
  }

  return Array.from(mergedByKey.values()).sort(sortChronological);
}
