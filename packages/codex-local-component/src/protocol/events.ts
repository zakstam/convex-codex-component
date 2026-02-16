import type { ServerInboundMessage } from "./generated.js";
import type { ThreadItem } from "./schemas/v2/ThreadItem.js";
import type { UserInput } from "./schemas/v2/UserInput.js";

export type ClassifiedMessage =
  | { scope: "thread"; kind: string; threadId: string }
  | { scope: "global"; kind: string };

export type CanonicalTerminalErrorCode =
  | "E_TERMINAL_INTERRUPTED"
  | "E_TERMINAL_FAILED"
  | "E_TERMINAL_PAYLOAD_PARSE_FAILED"
  | "E_TERMINAL_STATUS_UNEXPECTED"
  | "E_TERMINAL_ERROR_MISSING"
  | "E_TERMINAL_MESSAGE_MALFORMED";

export type CanonicalTerminalStatus =
  | { status: "completed" }
  | {
      status: "failed" | "interrupted";
      error: string;
      code: CanonicalTerminalErrorCode;
    };

export type CanonicalApprovalRequest = {
  itemId: string;
  kind: string;
  reason?: string;
};

export type CanonicalApprovalResolution = {
  itemId: string;
  status: "accepted" | "declined";
};

export type CanonicalItemSnapshot = {
  itemId: string;
  itemType: string;
  status: string;
  payloadJson: string;
  cursorEnd: number;
};

export type CanonicalDurableMessageRole = "user" | "assistant" | "system" | "tool";
export type CanonicalDurableMessageStatus = "streaming" | "completed" | "failed" | "interrupted";

export type CanonicalDurableMessage = {
  messageId: string;
  role: CanonicalDurableMessageRole;
  status: CanonicalDurableMessageStatus;
  sourceItemType: string;
  text: string;
  payloadJson: string;
};

export type CanonicalDurableMessageDelta = {
  messageId: string;
  delta: string;
};

export type CanonicalReasoningDelta = {
  itemId: string;
  channel: "summary" | "raw";
  segmentType: "textDelta" | "sectionBreak";
  summaryIndex?: number;
  contentIndex?: number;
  delta?: string;
};

const THREAD_METHOD_PREFIXES = ["thread/", "turn/", "item/", "rawResponseItem/"];
const TURN_COMPLETED_KINDS = new Set<string>(["turn/completed"]);
const TURN_FAILED_KINDS = new Set<string>(["error"]);
const PAYLOAD_PARSE_CACHE_LIMIT = 2000;
const payloadMessageCache = new Map<string, ServerInboundMessage | null>();

function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getThreadItemFromParams(params: unknown): ThreadItem | null {
  if (!isMessageRecord(params)) {
    return null;
  }
  const item = params.item;
  if (!isMessageRecord(item)) {
    return null;
  }
  if (typeof item.type !== "string" || typeof item.id !== "string") {
    return null;
  }
  return item as ThreadItem;
}

function parsePayloadMessage(payloadJson: string): ServerInboundMessage | null {
  const cached = payloadMessageCache.get(payloadJson);
  if (cached !== undefined) {
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    console.warn("[events] Failed to parse payload message JSON:", error);
    payloadMessageCache.set(payloadJson, null);
    return null;
  }
  if (!isMessageRecord(parsed)) {
    payloadMessageCache.set(payloadJson, null);
    return null;
  }
  if (!("method" in parsed) && !("id" in parsed)) {
    payloadMessageCache.set(payloadJson, null);
    return null;
  }
  const message = parsed as ServerInboundMessage;
  payloadMessageCache.set(payloadJson, message);
  if (payloadMessageCache.size > PAYLOAD_PARSE_CACHE_LIMIT) {
    const oldest = payloadMessageCache.keys().next().value;
    if (oldest !== undefined) {
      payloadMessageCache.delete(oldest);
    }
  }
  return message;
}

function parseMethodMessage<M extends string>(
  message: ServerInboundMessage,
  method: M,
): Extract<ServerInboundMessage, { method: M }> | null {
  if (!("method" in message) || message.method !== method) {
    return null;
  }
  return message as Extract<ServerInboundMessage, { method: M }>;
}

function parseMethodPayload<M extends string>(
  payloadJson: string,
  method: M,
): Extract<ServerInboundMessage, { method: M }> | null {
  const message = parsePayloadMessage(payloadJson);
  if (!message) {
    return null;
  }
  return parseMethodMessage(message, method);
}

function statusFromItem(item: ThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return item.status;
    case "fileChange":
      return item.status;
    default:
      return null;
  }
}

function durableRoleFromItem(item: ThreadItem): CanonicalDurableMessageRole {
  switch (item.type) {
    case "userMessage":
      return "user";
    case "agentMessage":
    case "plan":
    case "reasoning":
      return "assistant";
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "collabAgentToolCall":
    case "webSearch":
      return "tool";
    default:
      return "system";
  }
}

function flattenUserInput(input: UserInput): string {
  switch (input.type) {
    case "text":
      return input.text;
    case "image":
      return `[image] ${input.url}`;
    case "localImage":
      return `[localImage] ${input.path}`;
    case "skill":
      return `[skill] ${input.name} (${input.path})`;
    case "mention":
      return `[mention] ${input.name} (${input.path})`;
    default:
      return "";
  }
}

function durableTextFromItem(item: ThreadItem): string {
  switch (item.type) {
    case "userMessage":
      return item.content.map(flattenUserInput).join("\n").trim();
    case "agentMessage":
      return item.text;
    case "plan":
      return item.text;
    case "reasoning":
      return [...item.summary, ...item.content].join("\n").trim();
    case "commandExecution":
      return item.command;
    case "fileChange":
      return `File changes: ${item.changes.length}`;
    case "mcpToolCall":
      return item.error?.message ?? `${item.server}/${item.tool}`;
    case "collabAgentToolCall":
      return `${item.tool} (${item.status})`;
    case "webSearch":
      return item.query;
    case "imageView":
      return item.path;
    case "enteredReviewMode":
    case "exitedReviewMode":
      return item.review;
    case "contextCompaction":
      return "Context compaction";
    default:
      return "";
  }
}

function durableStatusForItemCompleted(item: ThreadItem): CanonicalDurableMessageStatus {
  if (item.type === "commandExecution" || item.type === "fileChange") {
    if (item.status === "failed") {
      return "failed";
    }
    if (item.status === "declined") {
      return "interrupted";
    }
  }
  return "completed";
}

function kindOf(message: ServerInboundMessage): string {
  if (!("method" in message)) {
    return "response";
  }
  return message.method;
}

function isThreadScopedByKind(kind: string): boolean {
  if (kind === "response") {
    return false;
  }
  if (kind === "applyPatchApproval" || kind === "execCommandApproval") {
    return true;
  }
  return THREAD_METHOD_PREFIXES.some((prefix) => kind.startsWith(prefix));
}

export function normalizeEventKind(kind: string): string {
  return kind;
}

export function extractThreadId(message: ServerInboundMessage): string | undefined {
  if (!("method" in message)) {
    return undefined;
  }
  if (!isMessageRecord(message.params)) {
    return undefined;
  }
  const params = message.params as Record<string, unknown>;
  if (typeof params.threadId === "string") {
    return params.threadId;
  }
  if (
    "thread" in params &&
    isMessageRecord(params.thread) &&
    "id" in params.thread &&
    typeof params.thread.id === "string"
  ) {
    return params.thread.id;
  }
  if (typeof params.conversationId === "string") {
    return params.conversationId;
  }
  return undefined;
}

export function classifyMessage(message: ServerInboundMessage): ClassifiedMessage {
  const kind = kindOf(message);
  const threadId = extractThreadId(message);
  if (threadId) {
    return { scope: "thread", kind, threadId };
  }
  if (isThreadScopedByKind(kind)) {
    throw new Error(`Thread-scoped protocol message missing threadId (kind=${kind})`);
  }
  return { scope: "global", kind };
}

export function extractTurnId(message: ServerInboundMessage): string | undefined {
  if (!("method" in message)) {
    return undefined;
  }
  if (message.method.startsWith("codex/event/")) {
    const params = isMessageRecord(message.params)
      ? (message.params as Record<string, unknown>)
      : null;
    if (!params || !isMessageRecord(params.msg)) {
      return undefined;
    }
    const msg = params.msg;
    if (typeof msg.turn_id === "string") {
      return msg.turn_id;
    }
    if (typeof msg.turnId === "string") {
      return msg.turnId;
    }
    return undefined;
  }
  const params = isMessageRecord(message.params)
    ? (message.params as Record<string, unknown>)
    : null;
  if (!params) {
    return undefined;
  }
  switch (message.method) {
    case "turn/started":
    case "turn/completed":
      if (!isMessageRecord(params.turn)) {
        return undefined;
      }
      return getStringField(params.turn, "id") ?? undefined;
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "thread/tokenUsage/updated":
    case "error":
      return getStringField(params, "turnId") ?? undefined;
    case "item/started":
    case "item/completed":
    case "rawResponseItem/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/mcpToolCall/progress":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
    case "thread/compacted":
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "item/tool/call":
      return getStringField(params, "turnId") ?? undefined;
    default:
      return undefined;
  }
}

export function turnIdForPayload(kind: string, payloadJson: string): string | null {
  const parsed = parseMethodPayload(payloadJson, kind);
  if (!parsed) {
    return null;
  }
  return extractTurnId(parsed) ?? null;
}

export function extractStreamId(_message: ServerInboundMessage): string | undefined {
  return undefined;
}

function terminalFailure(
  status: "failed" | "interrupted",
  code: CanonicalTerminalErrorCode,
  error: string,
): CanonicalTerminalStatus {
  return { status, code, error };
}

export function terminalStatusForMessage(message: ServerInboundMessage): CanonicalTerminalStatus | null {
  const kind = kindOf(message);
  if (!TURN_COMPLETED_KINDS.has(kind) && !TURN_FAILED_KINDS.has(kind)) {
    return null;
  }

  if (kind === "turn/completed") {
    const parsed = parseMethodMessage(message, "turn/completed");
    if (!parsed) {
      return terminalFailure(
        "failed",
        "E_TERMINAL_MESSAGE_MALFORMED",
        "turn/completed message shape is invalid",
      );
    }
    if (parsed.params.turn.status === "completed") {
      return { status: "completed" };
    }
    if (parsed.params.turn.status === "interrupted") {
      const interruptedMessage = parsed.params.turn.error?.message;
      if (typeof interruptedMessage !== "string" || interruptedMessage.length === 0) {
        return terminalFailure(
          "interrupted",
          "E_TERMINAL_ERROR_MISSING",
          "turn/completed interrupted status missing error.message",
        );
      }
      return {
        status: "interrupted",
        code: "E_TERMINAL_INTERRUPTED",
        error: interruptedMessage,
      };
    }
    if (parsed.params.turn.status === "failed") {
      const failedMessage = parsed.params.turn.error?.message;
      if (typeof failedMessage !== "string" || failedMessage.length === 0) {
        return terminalFailure(
          "failed",
          "E_TERMINAL_ERROR_MISSING",
          "turn/completed failed status missing error.message",
        );
      }
      return {
        status: "failed",
        code: "E_TERMINAL_FAILED",
        error: failedMessage,
      };
    }
    return terminalFailure(
      "failed",
      "E_TERMINAL_STATUS_UNEXPECTED",
      `turn/completed reported unexpected status "${parsed.params.turn.status}"`,
    );
  }

  const parsed = parseMethodMessage(message, "error");
  if (!parsed) {
    return terminalFailure(
      "failed",
      "E_TERMINAL_MESSAGE_MALFORMED",
      "error message shape is invalid",
    );
  }
  const errorMessage = parsed.params.error?.message;
  if (typeof errorMessage !== "string" || errorMessage.length === 0) {
    return terminalFailure(
      "failed",
      "E_TERMINAL_ERROR_MISSING",
      "error event missing params.error.message",
    );
  }
  return {
    status: "failed",
    code: "E_TERMINAL_FAILED",
    error: errorMessage,
  };
}

export function terminalStatusForPayload(
  kind: string,
  payloadJson: string,
): CanonicalTerminalStatus | null {
  if (!TURN_COMPLETED_KINDS.has(kind) && !TURN_FAILED_KINDS.has(kind)) {
    return null;
  }
  if (kind === "turn/completed") {
    const parsed = parseMethodPayload(payloadJson, "turn/completed");
    if (!parsed) {
      return terminalFailure(
        "failed",
        "E_TERMINAL_PAYLOAD_PARSE_FAILED",
        "Failed to parse payload for turn/completed terminal status",
      );
    }
    return terminalStatusForMessage(parsed);
  }
  const parsed = parseMethodPayload(payloadJson, "error");
  if (!parsed) {
    return terminalFailure(
      "failed",
      "E_TERMINAL_PAYLOAD_PARSE_FAILED",
      "Failed to parse payload for error terminal status",
    );
  }
  return terminalStatusForMessage(parsed);
}

export function approvalRequestForMessage(message: ServerInboundMessage): CanonicalApprovalRequest | null {
  if (!("method" in message)) {
    return null;
  }
  const params = isMessageRecord(message.params)
    ? (message.params as Record<string, unknown>)
    : null;
  if (!params) {
    return null;
  }
  if (message.method === "item/commandExecution/requestApproval") {
    const itemId = getStringField(params, "itemId");
    if (!itemId) {
      return null;
    }
    const reason = getStringField(params, "reason");
    return {
      itemId,
      kind: "commandExecution",
      ...(reason ? { reason } : {}),
    };
  }
  if (message.method === "item/fileChange/requestApproval") {
    const itemId = getStringField(params, "itemId");
    if (!itemId) {
      return null;
    }
    const reason = getStringField(params, "reason");
    return {
      itemId,
      kind: "fileChange",
      ...(reason ? { reason } : {}),
    };
  }
  return null;
}

export function approvalRequestForPayload(
  kind: string,
  payloadJson: string,
): CanonicalApprovalRequest | null {
  if (kind === "item/commandExecution/requestApproval") {
    const parsed = parseMethodPayload(payloadJson, "item/commandExecution/requestApproval");
    return parsed ? approvalRequestForMessage(parsed) : null;
  }
  if (kind === "item/fileChange/requestApproval") {
    const parsed = parseMethodPayload(payloadJson, "item/fileChange/requestApproval");
    return parsed ? approvalRequestForMessage(parsed) : null;
  }
  return null;
}

export function approvalResolutionForMessage(message: ServerInboundMessage): CanonicalApprovalResolution | null {
  const parsed = parseMethodMessage(message, "item/completed");
  if (!parsed) {
    return null;
  }
  const item = parsed.params.item;
  if (item.type !== "commandExecution" && item.type !== "fileChange") {
    return null;
  }
  if (item.status === "declined") {
    return { itemId: item.id, status: "declined" };
  }
  if (item.status === "completed" || item.status === "failed") {
    return { itemId: item.id, status: "accepted" };
  }
  return null;
}

export function approvalResolutionForPayload(
  kind: string,
  payloadJson: string,
): CanonicalApprovalResolution | null {
  if (kind !== "item/completed") {
    return null;
  }
  const parsed = parseMethodPayload(payloadJson, "item/completed");
  return parsed ? approvalResolutionForMessage(parsed) : null;
}

export function itemSnapshotForMessage(
  message: ServerInboundMessage,
  cursorEnd: number,
): CanonicalItemSnapshot | null {
  if (!("method" in message)) {
    return null;
  }
  if (message.method !== "item/started" && message.method !== "item/completed") {
    return null;
  }
  const item = getThreadItemFromParams(message.params);
  if (!item) {
    return null;
  }
  const status = statusFromItem(item);
  return {
    itemId: item.id,
    itemType: item.type,
    status: status ?? (message.method === "item/started" ? "inProgress" : "completed"),
    payloadJson: JSON.stringify(message),
    cursorEnd,
  };
}

export function itemSnapshotForPayload(
  kind: string,
  payloadJson: string,
  cursorEnd: number,
): CanonicalItemSnapshot | null {
  if (kind !== "item/started" && kind !== "item/completed") {
    return null;
  }
  const parsed =
    kind === "item/started"
      ? parseMethodPayload(payloadJson, "item/started")
      : parseMethodPayload(payloadJson, "item/completed");
  if (!parsed) {
    return null;
  }
  const status = statusFromItem(parsed.params.item);
  return {
    itemId: parsed.params.item.id,
    itemType: parsed.params.item.type,
    status: status ?? (kind === "item/started" ? "inProgress" : "completed"),
    payloadJson,
    cursorEnd,
  };
}

export function durableMessageForMessage(message: ServerInboundMessage): CanonicalDurableMessage | null {
  if (!("method" in message)) {
    return null;
  }
  if (message.method === "item/tool/call") {
    const params = isMessageRecord(message.params)
      ? (message.params as Record<string, unknown>)
      : null;
    const callId = params ? getStringField(params, "callId") : null;
    const tool = params ? getStringField(params, "tool") : null;
    if (!callId || !tool) {
      return null;
    }
    return {
      messageId: callId,
      role: "tool",
      status: "completed",
      sourceItemType: "dynamicToolCall",
      text: tool,
      payloadJson: JSON.stringify({
        type: "dynamicToolCall",
        id: callId,
        tool,
      }),
    };
  }
  if (message.method === "item/tool/requestUserInput") {
    const params = isMessageRecord(message.params)
      ? (message.params as Record<string, unknown>)
      : null;
    const itemId = params ? getStringField(params, "itemId") : null;
    if (!itemId) {
      return null;
    }
    return {
      messageId: itemId,
      role: "tool",
      status: "completed",
      sourceItemType: "toolUserInputRequest",
      text: "Tool requested user input",
      payloadJson: JSON.stringify({
        type: "toolUserInputRequest",
        id: itemId,
      }),
    };
  }
  if (message.method !== "item/started" && message.method !== "item/completed") {
    return null;
  }
  const item = getThreadItemFromParams(message.params);
  if (!item) {
    return null;
  }
  return {
    messageId: item.id,
    role: durableRoleFromItem(item),
    status: message.method === "item/started" ? "streaming" : durableStatusForItemCompleted(item),
    sourceItemType: item.type,
    text: durableTextFromItem(item),
    payloadJson: JSON.stringify(item),
  };
}

export function durableMessageForPayload(
  kind: string,
  payloadJson: string,
): CanonicalDurableMessage | null {
  if (kind === "item/started") {
    const parsed = parseMethodPayload(payloadJson, "item/started");
    return parsed ? durableMessageForMessage(parsed) : null;
  }
  if (kind === "item/completed") {
    const parsed = parseMethodPayload(payloadJson, "item/completed");
    return parsed ? durableMessageForMessage(parsed) : null;
  }
  if (kind === "item/tool/call") {
    const parsed = parseMethodPayload(payloadJson, "item/tool/call");
    return parsed ? durableMessageForMessage(parsed) : null;
  }
  if (kind === "item/tool/requestUserInput") {
    const parsed = parseMethodPayload(payloadJson, "item/tool/requestUserInput");
    return parsed ? durableMessageForMessage(parsed) : null;
  }
  return null;
}

export function durableMessageDeltaForMessage(
  message: ServerInboundMessage,
): CanonicalDurableMessageDelta | null {
  const parsed = parseMethodMessage(message, "item/agentMessage/delta");
  if (!parsed) {
    return null;
  }
  return {
    messageId: parsed.params.itemId,
    delta: parsed.params.delta,
  };
}

export function durableMessageDeltaForPayload(
  kind: string,
  payloadJson: string,
): CanonicalDurableMessageDelta | null {
  if (kind !== "item/agentMessage/delta") {
    return null;
  }
  const parsed = parseMethodPayload(payloadJson, "item/agentMessage/delta");
  return parsed ? durableMessageDeltaForMessage(parsed) : null;
}

export function reasoningDeltaForMessage(
  message: ServerInboundMessage,
): CanonicalReasoningDelta | null {
  const summaryTextDelta = parseMethodMessage(message, "item/reasoning/summaryTextDelta");
  if (summaryTextDelta) {
    return {
      itemId: summaryTextDelta.params.itemId,
      channel: "summary",
      segmentType: "textDelta",
      summaryIndex: summaryTextDelta.params.summaryIndex,
      delta: summaryTextDelta.params.delta,
    };
  }

  const summaryPartAdded = parseMethodMessage(message, "item/reasoning/summaryPartAdded");
  if (summaryPartAdded) {
    return {
      itemId: summaryPartAdded.params.itemId,
      channel: "summary",
      segmentType: "sectionBreak",
      summaryIndex: summaryPartAdded.params.summaryIndex,
    };
  }

  const reasoningTextDelta = parseMethodMessage(message, "item/reasoning/textDelta");
  if (reasoningTextDelta) {
    return {
      itemId: reasoningTextDelta.params.itemId,
      channel: "raw",
      segmentType: "textDelta",
      contentIndex: reasoningTextDelta.params.contentIndex,
      delta: reasoningTextDelta.params.delta,
    };
  }

  return null;
}

export function reasoningDeltaForPayload(
  kind: string,
  payloadJson: string,
): CanonicalReasoningDelta | null {
  if (kind === "item/reasoning/summaryTextDelta") {
    const parsed = parseMethodPayload(payloadJson, "item/reasoning/summaryTextDelta");
    return parsed ? reasoningDeltaForMessage(parsed) : null;
  }
  if (kind === "item/reasoning/summaryPartAdded") {
    const parsed = parseMethodPayload(payloadJson, "item/reasoning/summaryPartAdded");
    return parsed ? reasoningDeltaForMessage(parsed) : null;
  }
  if (kind === "item/reasoning/textDelta") {
    const parsed = parseMethodPayload(payloadJson, "item/reasoning/textDelta");
    return parsed ? reasoningDeltaForMessage(parsed) : null;
  }
  return null;
}
