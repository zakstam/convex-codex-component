import type { CodexUIMessage } from "./shared/types.js";
import {
  durableMessageDeltaForPayload,
  durableMessageForPayload,
  reasoningDeltaForPayload,
  terminalStatusForPayload,
  turnIdForPayload,
} from "./protocol/events.js";

export type CodexDurableMessageLike = {
  turnId: string;
  messageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  status: "streaming" | "completed" | "failed" | "interrupted";
  sourceItemType?: string;
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

export type CodexReasoningSegmentLike = {
  turnId: string;
  itemId: string;
  channel: "summary" | "raw";
  segmentType: "textDelta" | "sectionBreak";
  text: string;
  summaryIndex?: number;
  contentIndex?: number;
  createdAt: number;
  cursorEnd: number;
};

export type CodexReasoningOverlaySegment = {
  turnId: string;
  itemId: string;
  channel: "summary" | "raw";
  segmentType: "textDelta" | "sectionBreak";
  text: string;
  summaryIndex?: number;
  contentIndex?: number;
  lastCursor: number;
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

function overlayKey(turnId: string, messageId: string): string {
  return `${turnId}:${messageId}`;
}

function hasCanonicalMessageId(message: CodexDurableMessageLike): message is CodexDurableMessageLike & {
  messageId: string;
} {
  return typeof message.messageId === "string" && message.messageId.trim().length > 0;
}

export type CodexOverlayMessage = OverlayMessage;
export type CodexOverlayReasoningSegment = CodexReasoningOverlaySegment;

function reasoningOverlayKey(args: {
  turnId: string;
  itemId: string;
  channel: "summary" | "raw";
  segmentType: "textDelta" | "sectionBreak";
  summaryIndex?: number;
  contentIndex?: number;
}): string {
  return [
    args.turnId,
    args.itemId,
    args.channel,
    args.segmentType,
    args.summaryIndex ?? "none",
    args.contentIndex ?? "none",
  ].join(":");
}

function compareReasoningSegments(
  left: {
    turnId: string;
    itemId: string;
    channel: "summary" | "raw";
    summaryIndex?: number;
    contentIndex?: number;
    createdAt: number;
    cursorEnd: number;
  },
  right: {
  turnId: string;
  itemId: string;
  channel: "summary" | "raw";
  summaryIndex?: number;
  contentIndex?: number;
  createdAt: number;
  cursorEnd: number;
}): number {
  if (left.turnId !== right.turnId) {
    return left.turnId < right.turnId ? -1 : 1;
  }
  if (left.itemId !== right.itemId) {
    return left.itemId < right.itemId ? -1 : 1;
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  const leftSummary = left.summaryIndex ?? Number.MAX_SAFE_INTEGER;
  const rightSummary = right.summaryIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftSummary !== rightSummary) {
    return leftSummary - rightSummary;
  }
  const leftContent = left.contentIndex ?? Number.MAX_SAFE_INTEGER;
  const rightContent = right.contentIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftContent !== rightContent) {
    return leftContent - rightContent;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.cursorEnd - right.cursorEnd;
}

export function extractCodexOverlayMessages(
  deltas: CodexStreamDeltaLike[],
): Map<string, OverlayMessage> {
  const sorted = [...deltas].sort((a, b) => a.cursorEnd - b.cursorEnd);
  const byKey = new Map<string, OverlayMessage>();

  for (const delta of sorted) {
    if (delta.kind === "item/agentMessage/delta") {
      const turnId = turnIdForPayload(delta.kind, delta.payloadJson);
      const durableDelta = durableMessageDeltaForPayload(delta.kind, delta.payloadJson);
      const messageId = durableDelta?.messageId ?? null;
      const textDelta = durableDelta?.delta ?? null;
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
      const turnId = turnIdForPayload(delta.kind, delta.payloadJson);
      const message = durableMessageForPayload(delta.kind, delta.payloadJson);
      if (!turnId || !message || message.sourceItemType !== "agentMessage") {
        continue;
      }
      const key = overlayKey(turnId, message.messageId);
      const existing = byKey.get(key);
      const nextText = message.text ?? (existing?.text ?? "");
      byKey.set(key, {
        turnId,
        messageId: message.messageId,
        text: nextText,
        status: message.status === "streaming" ? (existing?.status ?? "streaming") : "completed",
        ...(existing?.error ? { error: existing.error } : {}),
        lastCursor: delta.cursorEnd,
      });
      continue;
    }

    if (delta.kind === "error") {
      const turnId = turnIdForPayload(delta.kind, delta.payloadJson);
      const terminal = terminalStatusForPayload(delta.kind, delta.payloadJson);
      if (!terminal || terminal.status === "completed") {
        continue;
      }
      const errorMessage = terminal.error;
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

export function extractCodexReasoningOverlaySegments(
  deltas: CodexStreamDeltaLike[],
  options?: { includeRaw?: boolean },
): Map<string, CodexReasoningOverlaySegment> {
  const includeRaw = options?.includeRaw ?? false;
  const sorted = [...deltas].sort((a, b) => a.cursorEnd - b.cursorEnd);
  const byKey = new Map<string, CodexReasoningOverlaySegment>();

  for (const delta of sorted) {
    if (
      delta.kind !== "item/reasoning/summaryTextDelta" &&
      delta.kind !== "item/reasoning/summaryPartAdded" &&
      delta.kind !== "item/reasoning/textDelta"
    ) {
      continue;
    }

    const turnId = turnIdForPayload(delta.kind, delta.payloadJson);
    const reasoningDelta = reasoningDeltaForPayload(delta.kind, delta.payloadJson);
    if (!turnId || !reasoningDelta) {
      continue;
    }
    if (reasoningDelta.channel === "raw" && !includeRaw) {
      continue;
    }

    const key = reasoningOverlayKey({
      turnId,
      itemId: reasoningDelta.itemId,
      channel: reasoningDelta.channel,
      segmentType: reasoningDelta.segmentType,
      ...(typeof reasoningDelta.summaryIndex === "number"
        ? { summaryIndex: reasoningDelta.summaryIndex }
        : {}),
      ...(typeof reasoningDelta.contentIndex === "number"
        ? { contentIndex: reasoningDelta.contentIndex }
        : {}),
    });
    const existing = byKey.get(key);
    byKey.set(key, {
      turnId,
      itemId: reasoningDelta.itemId,
      channel: reasoningDelta.channel,
      segmentType: reasoningDelta.segmentType,
      text:
        reasoningDelta.segmentType === "textDelta"
          ? `${existing?.text ?? ""}${reasoningDelta.delta ?? ""}`
          : "",
      ...(typeof reasoningDelta.summaryIndex === "number"
        ? { summaryIndex: reasoningDelta.summaryIndex }
        : {}),
      ...(typeof reasoningDelta.contentIndex === "number"
        ? { contentIndex: reasoningDelta.contentIndex }
        : {}),
      lastCursor: delta.cursorEnd,
    });
  }

  return byKey;
}

export function aggregateCodexReasoningSegments(
  segments: CodexReasoningSegmentLike[],
  options?: { includeRaw?: boolean },
): CodexReasoningSegmentLike[] {
  const includeRaw = options?.includeRaw ?? false;
  const sorted = [...segments].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.cursorEnd - b.cursorEnd;
  });
  const byKey = new Map<string, CodexReasoningSegmentLike>();

  for (const segment of sorted) {
    if (segment.channel === "raw" && !includeRaw) {
      continue;
    }
    const key = reasoningOverlayKey({
      turnId: segment.turnId,
      itemId: segment.itemId,
      channel: segment.channel,
      segmentType: segment.segmentType,
      ...(typeof segment.summaryIndex === "number" ? { summaryIndex: segment.summaryIndex } : {}),
      ...(typeof segment.contentIndex === "number" ? { contentIndex: segment.contentIndex } : {}),
    });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...segment });
      continue;
    }
    byKey.set(key, {
      ...existing,
      text: segment.segmentType === "textDelta" ? `${existing.text}${segment.text}` : "",
      createdAt: Math.min(existing.createdAt, segment.createdAt),
      cursorEnd: Math.max(existing.cursorEnd, segment.cursorEnd),
    });
  }

  return Array.from(byKey.values()).sort(compareReasoningSegments);
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
  if ((STATUS_PRIORITY[overlayStatus] ?? 0) > (STATUS_PRIORITY[durableStatus] ?? 0)) {
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
  if (!hasCanonicalMessageId(message)) {
    throw new Error("toCodexUIMessage requires durable messageId.");
  }
  return {
    messageId: message.messageId,
    turnId: message.turnId,
    role: message.role,
    status: message.status,
    ...(message.sourceItemType ? { sourceItemType: message.sourceItemType } : {}),
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
    if (!hasCanonicalMessageId(durable)) {
      continue;
    }
    const key = overlayKey(durable.turnId, durable.messageId);
    const overlay = overlayByKey.get(key);

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
