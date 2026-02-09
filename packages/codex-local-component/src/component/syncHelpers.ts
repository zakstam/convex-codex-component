import type { ServerInboundMessage } from "../protocol/generated.js";
import type { ThreadItem } from "../protocol/schemas/v2/ThreadItem.js";
import type { UserInput } from "../protocol/schemas/v2/UserInput.js";

const TURN_COMPLETED_KINDS = new Set<string>(["turn/completed"]);
const TURN_INTERRUPTED_KINDS = new Set<string>(["codex/event/turn_aborted"]);
const TURN_FAILED_KINDS = new Set<string>(["error"]);
const TERMINAL_STATUS_PRIORITY = {
  completed: 1,
  interrupted: 2,
  failed: 3,
} as const;

export type TerminalTurnStatus = {
  status: "completed" | "failed" | "interrupted";
  error?: string;
};

export type ApprovalRequest = {
  itemId: string;
  kind: string;
  reason?: string;
};

export type ApprovalResolution = {
  itemId: string;
  status: "accepted" | "declined";
};

export type ItemSnapshot = {
  itemId: string;
  itemType: string;
  status: string;
  payloadJson: string;
  cursorEnd: number;
};

export type DurableMessageRole = "user" | "assistant" | "system" | "tool";
export type DurableMessageStatus = "streaming" | "completed" | "failed" | "interrupted";

export type DurableMessageFromEvent = {
  messageId: string;
  role: DurableMessageRole;
  status: DurableMessageStatus;
  sourceItemType: string;
  text: string;
  payloadJson: string;
};

export type DurableMessageDeltaFromEvent = {
  messageId: string;
  delta: string;
};

type MethodMessage<M extends string> = Extract<ServerInboundMessage, { method: M }>;

function parseMethodPayload<M extends string>(payloadJson: string, method: M): MethodMessage<M> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || !("method" in parsed)) {
    return null;
  }
  if ((parsed as { method?: unknown }).method !== method) {
    return null;
  }
  if (!("params" in parsed) || typeof (parsed as { params?: unknown }).params !== "object") {
    return null;
  }

  return parsed as MethodMessage<M>;
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

function durableRoleFromItem(item: ThreadItem): DurableMessageRole {
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
      return item.aggregatedOutput ?? item.command;
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

function durableStatusForItemCompleted(item: ThreadItem): DurableMessageStatus {
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

export function terminalStatusForEvent(kind: string, payloadJson: string): TerminalTurnStatus | null {
  if (TURN_COMPLETED_KINDS.has(kind)) {
    const parsed = parseMethodPayload(payloadJson, "turn/completed");
    if (parsed) {
      if (parsed.params.turn.status === "completed") {
        return { status: "completed" };
      }
      if (parsed.params.turn.status === "interrupted") {
        return {
          status: "interrupted",
          error: parsed.params.turn.error?.message ?? "turn interrupted",
        };
      }
      if (parsed.params.turn.status === "failed") {
        return {
          status: "failed",
          error: parsed.params.turn.error?.message ?? "turn failed",
        };
      }
    }
    return { status: "completed" };
  }

  if (TURN_FAILED_KINDS.has(kind)) {
    const parsed = parseMethodPayload(payloadJson, "error");
    if (parsed) {
      return { status: "failed", error: parsed.params.error.message };
    }
    return { status: "failed", error: "stream error" };
  }

  if (TURN_INTERRUPTED_KINDS.has(kind)) {
    return { status: "interrupted", error: "turn aborted" };
  }

  return null;
}

export function pickHigherPriorityTerminalStatus(
  current: TerminalTurnStatus | undefined,
  next: TerminalTurnStatus,
): TerminalTurnStatus {
  if (!current) {
    return next;
  }
  if (TERMINAL_STATUS_PRIORITY[next.status] > TERMINAL_STATUS_PRIORITY[current.status]) {
    return next;
  }
  return current;
}

export function parseApprovalRequest(kind: string, payloadJson: string): ApprovalRequest | null {
  if (kind === "item/commandExecution/requestApproval") {
    const parsed = parseMethodPayload(payloadJson, "item/commandExecution/requestApproval");
    if (!parsed) {
      return null;
    }
    return {
      itemId: parsed.params.itemId,
      kind: "commandExecution",
      ...(parsed.params.reason ? { reason: parsed.params.reason } : {}),
    };
  }

  if (kind === "item/fileChange/requestApproval") {
    const parsed = parseMethodPayload(payloadJson, "item/fileChange/requestApproval");
    if (!parsed) {
      return null;
    }
    return {
      itemId: parsed.params.itemId,
      kind: "fileChange",
      ...(parsed.params.reason ? { reason: parsed.params.reason } : {}),
    };
  }

  return null;
}

export function parseApprovalResolution(kind: string, payloadJson: string): ApprovalResolution | null {
  if (kind !== "item/completed") {
    return null;
  }

  const parsed = parseMethodPayload(payloadJson, "item/completed");
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

export function parseItemSnapshot(
  kind: string,
  payloadJson: string,
  cursorEnd: number,
): ItemSnapshot | null {
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

export function parseDurableMessageEvent(kind: string, payloadJson: string): DurableMessageFromEvent | null {
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

  const item = parsed.params.item;
  return {
    messageId: item.id,
    role: durableRoleFromItem(item),
    status: kind === "item/started" ? "streaming" : durableStatusForItemCompleted(item),
    sourceItemType: item.type,
    text: durableTextFromItem(item),
    payloadJson: JSON.stringify(item),
  };
}

export function parseDurableMessageDeltaEvent(
  kind: string,
  payloadJson: string,
): DurableMessageDeltaFromEvent | null {
  if (kind !== "item/agentMessage/delta") {
    return null;
  }

  const parsed = parseMethodPayload(payloadJson, "item/agentMessage/delta");
  if (!parsed) {
    return null;
  }

  return {
    messageId: parsed.params.itemId,
    delta: parsed.params.delta,
  };
}

export function assertContinuousStreamDeltas(
  streamId: string,
  requestedCursor: number,
  deltas: Array<{ cursorStart: number; cursorEnd: number }>,
): { ok: true } | { ok: false; expected: number; actual: number } {
  let expected = requestedCursor;
  for (const delta of deltas) {
    if (delta.cursorStart !== expected) {
      return { ok: false, expected, actual: delta.cursorStart };
    }
    expected = delta.cursorEnd;
  }
  return { ok: true };
}
