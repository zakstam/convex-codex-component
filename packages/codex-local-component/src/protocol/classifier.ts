import type { ServerInboundMessage } from "./generated.js";

export type ClassifiedMessage =
  | { scope: "thread"; kind: string; threadId: string }
  | { scope: "global"; kind: string };

const THREAD_METHOD_PREFIXES = ["thread/", "turn/", "item/"];

function kindOf(message: ServerInboundMessage): string {
  if (!("method" in message)) {
    return "response";
  }
  return message.method;
}

function extractThreadId(message: ServerInboundMessage): string | undefined {
  if (!("method" in message)) {
    return undefined;
  }

  if ("threadId" in message.params && typeof message.params.threadId === "string") {
    return message.params.threadId;
  }
  if (
    "thread" in message.params &&
    typeof message.params.thread === "object" &&
    message.params.thread !== null &&
    "id" in message.params.thread &&
    typeof message.params.thread.id === "string"
  ) {
    return message.params.thread.id;
  }

  if (
    "conversationId" in message.params &&
    typeof message.params.conversationId === "string"
  ) {
    return message.params.conversationId;
  }

  return undefined;
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
    if ("msg" in message.params && typeof message.params.msg === "object" && message.params.msg !== null) {
      const msg = message.params.msg as Record<string, unknown>;
      if ("turn_id" in msg && typeof msg.turn_id === "string") {
        return msg.turn_id;
      }
      if ("turnId" in msg && typeof msg.turnId === "string") {
        return msg.turnId;
      }
      if (
        ("type" in msg && msg.type === "task_started") ||
        ("type" in msg && msg.type === "task_complete")
      ) {
        if ("id" in message.params && typeof message.params.id === "string") {
          return message.params.id;
        }
      }
    }
    return undefined;
  }

  switch (message.method) {
    case "turn/started":
    case "turn/completed":
      return message.params.turn.id;
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "thread/tokenUsage/updated":
    case "error":
      return message.params.turnId;
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
      return message.params.turnId;
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "item/tool/call":
      return message.params.turnId;
    default:
      return undefined;
  }
}

export function extractStreamId(_message: ServerInboundMessage): string | undefined {
  return undefined;
}
