import Ajv from "ajv";
import clientNotificationSchema from "./schemas/ClientNotification.json";
import clientRequestSchema from "./schemas/ClientRequest.json";
import eventMsgSchema from "./schemas/EventMsg.json";
import jsonRpcMessageSchema from "./schemas/JSONRPCMessage.json";
import jsonRpcResponseSchema from "./schemas/JSONRPCResponse.json";
import serverNotificationSchema from "./schemas/ServerNotification.json";
import serverRequestSchema from "./schemas/ServerRequest.json";
import type {
  ClientOutboundMessage,
  LegacyEventNotification,
  ServerInboundMessage,
} from "./generated.js";

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
    isLegacyEventNotificationValue(value)
  );
}

function isClientOutboundMessage(value: unknown): value is ClientOutboundMessage {
  return (validateClientRequest(value) as boolean) || (validateClientNotification(value) as boolean);
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

export function assertValidClientMessage(message: unknown): asserts message is ClientOutboundMessage {
  if (isClientOutboundMessage(message)) {
    return;
  }
  const details =
    formatAjvErrors(validateClientRequest.errors as AjvError[] | null | undefined) +
    "; " +
    formatAjvErrors(validateClientNotification.errors as AjvError[] | null | undefined);
  throw new CodexProtocolSendError(`Invalid outbound codex client message: ${details}`);
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
