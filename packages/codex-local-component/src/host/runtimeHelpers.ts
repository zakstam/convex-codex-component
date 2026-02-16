/**
 * Standalone utility functions and constants for the CodexHostRuntime.
 * All functions here are pure (no closures over mutable state).
 */
import type { CodexResponse, NormalizedEvent, ServerInboundMessage, RpcId } from "../protocol/generated.js";
import type { ToolRequestUserInputQuestion } from "../protocol/schemas/v2/ToolRequestUserInputQuestion.js";
import type { ChatgptAuthTokensRefreshParams } from "../protocol/schemas/v2/ChatgptAuthTokensRefreshParams.js";
import { terminalStatusForPayload } from "../protocol/events.js";
import type { TerminalTurnStatus } from "../shared/status.js";
import type {
  IngestSafeError,
  ManagedServerRequestMethod,
  PendingServerRequest,
} from "./runtimeTypes.js";

// ── Constants ─────────────────────────────────────────────────────────

export const MAX_BATCH_SIZE = 32;
export const PENDING_SERVER_REQUEST_RETRY_DELAY_MS = 150;
export const PENDING_SERVER_REQUEST_RETRY_TTL_MS = 5_000;
export const PENDING_SERVER_REQUEST_MAX_RETRIES = 20;
export const MANAGED_SERVER_REQUEST_METHODS = new Set<ManagedServerRequestMethod>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
]);
export const TURN_SCOPED_EVENT_PREFIXES = ["turn/", "item/"];

// ── Pure utility functions ────────────────────────────────────────────

export function toRequestKey(requestId: RpcId): string {
  return `${typeof requestId}:${String(requestId)}`;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || typeof value === "number";
}

export function isManagedServerRequestMethod(value: string): value is ManagedServerRequestMethod {
  return (
    value === "item/commandExecution/requestApproval" ||
    value === "item/fileChange/requestApproval" ||
    value === "item/tool/requestUserInput" ||
    value === "item/tool/call"
  );
}

export function isToolRequestUserInputQuestion(value: unknown): value is ToolRequestUserInputQuestion {
  const question = asObject(value);
  if (!question) {
    return false;
  }
  return (
    typeof question.id === "string" &&
    typeof question.header === "string" &&
    typeof question.question === "string" &&
    typeof question.isOther === "boolean" &&
    typeof question.isSecret === "boolean" &&
    (question.options === null || Array.isArray(question.options))
  );
}

export function shouldDropRejectedIngestBatch(errors: IngestSafeError[]): boolean {
  if (errors.length === 0) {
    return false;
  }
  return errors.every((error) => error.code === "OUT_OF_ORDER");
}

export function isTurnNotFoundPersistenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Turn not found:");
}

export function isTurnScopedEvent(kind: string): boolean {
  return kind === "error" || TURN_SCOPED_EVENT_PREFIXES.some((prefix) => kind.startsWith(prefix));
}

export function randomSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isServerNotification(message: ServerInboundMessage): message is ServerInboundMessage & { method: string } {
  return "method" in message;
}

export function isChatgptAuthTokensRefreshRequest(
  message: ServerInboundMessage,
): message is {
  method: "account/chatgptAuthTokens/refresh";
  id: RpcId;
  params: ChatgptAuthTokensRefreshParams;
} {
  if (
    !("method" in message) ||
    message.method !== "account/chatgptAuthTokens/refresh" ||
    !("id" in message) ||
    (typeof message.id !== "number" && typeof message.id !== "string") ||
    !("params" in message)
  ) {
    return false;
  }
  const params = asObject(message.params);
  return !!params && typeof params.reason === "string";
}

export function isResponse(message: ServerInboundMessage): message is CodexResponse {
  return "id" in message && !isServerNotification(message);
}

export function parseTurnCompletedStatus(payloadJson: string): TerminalTurnStatus {
  const terminal = terminalStatusForPayload("turn/completed", payloadJson);
  if (!terminal) {
    throw new Error("turn/completed payload did not produce terminal status");
  }
  if (terminal.status === "failed") {
    return "failed";
  }
  if (terminal.status === "interrupted") {
    return "interrupted";
  }
  return "completed";
}

export function parseManagedServerRequestFromEvent(event: NormalizedEvent): PendingServerRequest | null {
  if (!isManagedServerRequestMethod(event.kind)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.payloadJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse managed server request payload: ${reason}`);
  }

  const message = asObject(parsed);
  if (!message || typeof message.method !== "string") {
    throw new Error("Managed server request payload missing method");
  }
  if (!isManagedServerRequestMethod(message.method)) {
    throw new Error(`Managed server request method mismatch: ${String(message.method)}`);
  }
  if (!isRpcId(message.id)) {
    throw new Error("Managed server request payload missing valid JSON-RPC id");
  }
  const params = asObject(message.params);
  if (!params) {
    throw new Error("Managed server request payload missing params object");
  }
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string") {
    throw new Error("Managed server request payload missing threadId/turnId");
  }

  const method = message.method;
  const itemId =
    typeof params.itemId === "string"
      ? params.itemId
      : method === "item/tool/call" && typeof params.callId === "string"
        ? params.callId
        : null;
  if (!itemId) {
    throw new Error(`Managed server request payload missing item id for ${method}`);
  }
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const questionsRaw = params.questions;
  let questions: ToolRequestUserInputQuestion[] | undefined;
  if (method === "item/tool/requestUserInput") {
    if (!Array.isArray(questionsRaw)) {
      throw new Error("Managed tool requestUserInput payload missing questions array");
    }
    if (!questionsRaw.every(isToolRequestUserInputQuestion)) {
      throw new Error("Managed tool requestUserInput payload has invalid question shape");
    }
    questions = questionsRaw;
  }

  return {
    requestId: message.id,
    method,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt,
    ...(reason ? { reason } : {}),
    ...(questions ? { questions } : {}),
  };
}

export function rewritePayloadTurnId(args: {
  kind: string;
  payloadJson: string;
  runtimeTurnId?: string;
  persistedTurnId: string;
}): string {
  const { kind, payloadJson, runtimeTurnId, persistedTurnId } = args;
  if (!runtimeTurnId || runtimeTurnId === persistedTurnId) {
    return payloadJson;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    console.warn("[runtimeHelpers] Failed to parse payloadJson for turnId rewrite:", error);
    return payloadJson;
  }
  const message = asObject(parsed);
  if (!message) {
    return payloadJson;
  }
  if (kind.startsWith("codex/event/")) {
    const params = asObject(message.params);
    const msg = params ? asObject(params.msg) : null;
    if (!msg) {
      return payloadJson;
    }
    if (typeof msg.turn_id === "string") {
      msg.turn_id = persistedTurnId;
    }
    if (typeof msg.turnId === "string") {
      msg.turnId = persistedTurnId;
    }
    return JSON.stringify(parsed);
  }
  const params = asObject(message.params);
  if (!params) {
    return payloadJson;
  }
  if (kind === "turn/started" || kind === "turn/completed") {
    const turn = asObject(params.turn);
    if (!turn || typeof turn.id !== "string") {
      return payloadJson;
    }
    turn.id = persistedTurnId;
    return JSON.stringify(parsed);
  }
  if (typeof params.turnId === "string") {
    params.turnId = persistedTurnId;
    return JSON.stringify(parsed);
  }
  if (typeof params.turn_id === "string") {
    params.turn_id = persistedTurnId;
    return JSON.stringify(parsed);
  }
  return payloadJson;
}
