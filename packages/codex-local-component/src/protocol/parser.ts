import Ajv from "ajv";
import clientNotificationSchema from "./schemas/ClientNotification.json" with { type: "json" };
import clientRequestSchema from "./schemas/ClientRequest.json" with { type: "json" };
import eventMsgSchema from "./schemas/EventMsg.json" with { type: "json" };
import jsonRpcMessageSchema from "./schemas/JSONRPCMessage.json" with { type: "json" };
import jsonRpcResponseSchema from "./schemas/JSONRPCResponse.json" with { type: "json" };
import commandExecutionRequestApprovalResponseSchema from "./schemas/CommandExecutionRequestApprovalResponse.json" with { type: "json" };
import fileChangeRequestApprovalResponseSchema from "./schemas/FileChangeRequestApprovalResponse.json" with { type: "json" };
import serverNotificationSchema from "./schemas/ServerNotification.json" with { type: "json" };
import serverRequestSchema from "./schemas/ServerRequest.json" with { type: "json" };
import toolRequestUserInputResponseSchema from "./schemas/ToolRequestUserInputResponse.json" with { type: "json" };
import type {
  LegacyEventNotification,
  ServerInboundMessage,
} from "./generated.js";
import type { ClientOutboundWireMessage } from "./outbound.js";

type AjvError = {
  instancePath?: string;
  message?: string;
};

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addFormat("int64", true);
ajv.addFormat("int32", true);
ajv.addFormat("uint64", true);
ajv.addFormat("uint32", true);
ajv.addFormat("uint16", true);
ajv.addFormat("uint", true);
ajv.addFormat("double", true);
ajv.addFormat("float", true);

const validateJsonRpcMessage = ajv.compile(jsonRpcMessageSchema);
const validateServerNotification = ajv.compile(serverNotificationSchema);
const validateServerRequest = ajv.compile(serverRequestSchema);
const validateJsonRpcResponse = ajv.compile(jsonRpcResponseSchema);
const validateClientRequest = ajv.compile(clientRequestSchema);
const validateClientNotification = ajv.compile(clientNotificationSchema);
const validateCommandExecutionRequestApprovalResponse = ajv.compile(commandExecutionRequestApprovalResponseSchema);
const validateFileChangeRequestApprovalResponse = ajv.compile(fileChangeRequestApprovalResponseSchema);
const validateToolRequestUserInputResponse = ajv.compile(toolRequestUserInputResponseSchema);
const validateEventMsg = ajv.compile(eventMsgSchema);

function formatAjvErrors(errors: AjvError[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "no schema details available";
  }
  return errors
    .map((err) => {
      const at = err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/";
      return `${at}: ${err.message ?? "invalid"}`;
    })
    .join("; ");
}

export class CodexProtocolParseError extends Error {
  constructor(message: string, public readonly rawLine: string) {
    super(message);
    this.name = "CodexProtocolParseError";
  }
}

export class CodexProtocolSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexProtocolSendError";
  }
}

function isServerInboundMessage(value: unknown): value is ServerInboundMessage {
  return (
    (validateServerNotification(value) as boolean) ||
    (validateServerRequest(value) as boolean) ||
    (validateJsonRpcResponse(value) as boolean) ||
    isLegacyEventNotificationValue(value) ||
    isUnknownServerResponse(value) ||
    isUnknownServerNotification(value) ||
    isUnknownServerRequest(value)
  );
}

function isClientServerRequestResponse(value: unknown): value is ClientOutboundWireMessage {
  if (!(validateJsonRpcResponse(value) as boolean)) {
    return false;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "number" && typeof record.id !== "string") {
    return false;
  }
  if (!("result" in record)) {
    return false;
  }
  return (
    (validateCommandExecutionRequestApprovalResponse(record.result) as boolean) ||
    (validateFileChangeRequestApprovalResponse(record.result) as boolean) ||
    (validateToolRequestUserInputResponse(record.result) as boolean)
  );
}

function isClientOutboundMessage(value: unknown): value is ClientOutboundWireMessage {
  return (
    (validateClientRequest(value) as boolean) ||
    (validateClientNotification(value) as boolean) ||
    isClientServerRequestResponse(value)
  );
}

// `unknown` is intentionally used only at the wire boundary.
// All outbound values are validated against the generated JSON-RPC schema.
export function parseWireMessage(line: string): ServerInboundMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CodexProtocolParseError(`Invalid JSON from codex app-server: ${reason}`, line);
  }

  if (!(validateJsonRpcMessage(parsed) as boolean)) {
    const details = formatAjvErrors(validateJsonRpcMessage.errors as AjvError[] | null | undefined);
    throw new CodexProtocolParseError(
      `JSON-RPC schema validation failed for codex message: ${details}`,
      line,
    );
  }

  if (!isServerInboundMessage(parsed)) {
    throw new CodexProtocolParseError(
      "Message is valid JSON-RPC but not a supported codex server notification/request/response shape.",
      line,
    );
  }

  return parsed;
}

export function assertValidClientMessage(message: unknown): asserts message is ClientOutboundWireMessage {
  if (isClientOutboundMessage(message)) {
    return;
  }
  const details =
    formatAjvErrors(validateClientRequest.errors as AjvError[] | null | undefined) +
    "; " +
    formatAjvErrors(validateClientNotification.errors as AjvError[] | null | undefined) +
    "; " +
    formatAjvErrors(validateJsonRpcResponse.errors as AjvError[] | null | undefined) +
    "; " +
    formatAjvErrors(validateCommandExecutionRequestApprovalResponse.errors as AjvError[] | null | undefined) +
    "; " +
    formatAjvErrors(validateFileChangeRequestApprovalResponse.errors as AjvError[] | null | undefined) +
    "; " +
    formatAjvErrors(validateToolRequestUserInputResponse.errors as AjvError[] | null | undefined);
  throw new CodexProtocolSendError(`Invalid outbound codex client message: ${details}`);
}

function isUnknownServerNotification(value: unknown): value is ServerInboundMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.method !== "string") {
    return false;
  }
  if (record.method.startsWith("codex/event/")) {
    return false;
  }
  if ("params" in record && (typeof record.params !== "object" || record.params === null)) {
    return false;
  }
  if ("id" in record) {
    return false;
  }
  return true;
}

function isUnknownServerRequest(value: unknown): value is ServerInboundMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.method !== "string") {
    return false;
  }
  if (record.method.startsWith("codex/event/")) {
    return false;
  }
  if ("params" in record && (typeof record.params !== "object" || record.params === null)) {
    return false;
  }
  if (typeof record.id !== "string" && typeof record.id !== "number") {
    return false;
  }
  return true;
}

function isUnknownServerResponse(value: unknown): value is ServerInboundMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if ("method" in record) {
    return false;
  }
  if (typeof record.id !== "string" && typeof record.id !== "number" && record.id !== null) {
    return false;
  }
  if (!("result" in record) && !("error" in record)) {
    return false;
  }
  return true;
}

function isLegacyEventNotificationValue(value: unknown): value is LegacyEventNotification {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.method !== "string" || !record.method.startsWith("codex/event/")) {
    return false;
  }
  if (typeof record.params !== "object" || record.params === null) {
    return false;
  }
  const params = record.params as Record<string, unknown>;
  if (typeof params.conversationId !== "string") {
    return false;
  }
  return validateEventMsg(params.msg) as boolean;
}
